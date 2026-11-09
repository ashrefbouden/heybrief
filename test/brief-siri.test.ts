import { describe, expect, it } from 'vitest';
import { budgetFor, rankMyDay } from '../src/engine/brief/drive';
import { HeyBrief } from '../src/engine/heybrief';
import { authenticate, hashToken, issueToken, parseSiriBody, RATE_LIMIT_PER_MINUTE, revokeToken } from '../src/engine/siri/auth';
import { guardPhrase, capWords, wordCount } from '../src/engine/speak';
import { detectLang } from '../src/engine/lang';
import { demo, ME, NOW } from './helpers';

const auth = (t: string) => ({ authorization: [`Bearer ${t}`] });

describe('drive-sized brief', () => {
  it.each([
    [3, 1, 0],
    [11, 3, 1],
    [25, 5, 1],
  ])('%i minutes -> %i things, %i decision', (eta, things, decisions) => expect(budgetFor(eta)).toEqual({ things, decisions }));

  it('ranks my day: in progress before to do, high priority first', () => {
    const { issues } = demo();
    expect(rankMyDay(issues, ME.accountId, '2026-11-16').map((i) => i.key)).toEqual(['MP-12', 'MP-15', 'MP-9']);
  });

  it('fits the brief to an 11 minute drive and offers one decision', async () => {
    const { deps } = demo();
    const a = await new HeyBrief(deps).brief(ME.accountId, { etaMinutes: 11 });
    expect(a.speech).toMatch(/^You have 11 minutes: 3 things, 1 decision\./);
    expect(a.speech).toContain('Want me to create a follow-up for Lina due Wednesday?');
    expect(a.expectReply).toBe(true);
    expect(wordCount(a.speech)).toBeLessThanOrEqual(60);
  });

  it('a 3 minute drive gets one thing and no decision', async () => {
    const { deps } = demo();
    const a = await new HeyBrief(deps).brief(ME.accountId, { etaMinutes: 3 });
    expect(a.speech).toBe('You have 3 minutes: 1 thing. MP-12, Fix login redirect on Safari.');
    expect(a.expectReply).toBe(false);
  });
});

describe('Risk Radar flow (judge script steps 3 to 5)', () => {
  it('radar -> why -> yes creates the linked follow-up with the audit comment', async () => {
    const { deps, jira } = demo();
    const hb = new HeyBrief(deps);
    const r = await hb.radar(ME.accountId, { kind: 'project', projectKey: 'MP' });
    expect((r.data as any).risks).toHaveLength(3);
    expect((r.data as any).risks[0]).toMatchObject({ key: 'MP-42', label: 'confirmed', sources: ['MP-42', 'MP-45', 'MP-51'] });

    const why = await hb.why(ME.accountId);
    expect(why.speech).toContain('blocked 6 days');
    expect(why.pendingId).toBe(r.pendingId);

    const yes = await hb.confirm(ME.accountId, 'yes', r.pendingId);
    expect(yes.speech).toBe('Done. 1 change saved. MP-901.');
    const created = jira.issues.get('MP-901')!;
    expect(created.summary).toBe('Unblock MP-42: Renew SSO certificate');
    expect(created.blocks).toEqual(['MP-42']);
    expect(jira.comments.find((c) => c.key === 'MP-42')!.body).toContain('approved by voice by [~accountid:me-1]');
  });
});

describe('Siri routing', () => {
  it('routes free speech: brief, risks, talk-back, then yes', async () => {
    const { deps, jira } = demo();
    const hb = new HeyBrief(deps, { projectKeys: ['MP'] });
    expect((await hb.route(ME.accountId, 'brief me', { etaMinutes: 11 })).speech).toMatch(/^You have 11 minutes/);
    expect((await hb.route(ME.accountId, "what's at risk this week?")).speech).toMatch(/^3 risks this week/);
    const tb = await hb.route(ME.accountId, 'I finished MP-12');
    expect(tb.speech).toMatch(/^1 change\. MP-12 to Done\./);
    expect((await hb.route(ME.accountId, 'yes')).speech).toBe('Done. 1 change saved.');
    expect(jira.issues.get('MP-12')!.status).toBe('Done');
  });

  it('a new request while a write is pending cancels the write', async () => {
    const { deps, jira } = demo();
    const hb = new HeyBrief(deps, { projectKeys: ['MP'] });
    await hb.route(ME.accountId, 'I finished MP-12');
    await hb.route(ME.accountId, 'brief me');
    // the brief proposed its own decision; saying no cancels that, and MP-12 never moved
    await hb.route(ME.accountId, 'no');
    expect(jira.issues.get('MP-12')!.status).toBe('In Progress');
    expect(jira.writes()).toEqual([]);
  });
});

describe('Siri pairing and request guard', () => {
  it('stores only the hash and maps it to the account', async () => {
    const { store, clock } = demo();
    const token = await issueToken(store, clock, ME.accountId);
    expect(token).toMatch(/^hb_[A-Za-z0-9_-]{43}$/);
    expect([...store.data.keys()].some((k) => k.includes(token))).toBe(false);
    expect(await store.get(`pair:${hashToken(token)}`)).toMatchObject({ accountId: ME.accountId });
    expect(await authenticate(store, clock, auth(token))).toMatchObject({ ok: true, accountId: ME.accountId });
  });

  it('missing, malformed or unknown token -> 401', async () => {
    const { store, clock } = demo();
    expect(await authenticate(store, clock, {})).toMatchObject({ ok: false, status: 401 });
    expect(await authenticate(store, clock, { authorization: ['Basic abc'] })).toMatchObject({ status: 401 });
    expect(await authenticate(store, clock, auth('hb_' + 'x'.repeat(43)))).toMatchObject({ status: 401 });
  });

  it('rotated token -> 401, new token works', async () => {
    const { store, clock } = demo();
    const old = await issueToken(store, clock, ME.accountId);
    const fresh = await issueToken(store, clock, ME.accountId);
    expect(await authenticate(store, clock, auth(old))).toMatchObject({ status: 401 });
    expect(await authenticate(store, clock, auth(fresh))).toMatchObject({ ok: true });
    await revokeToken(store, ME.accountId);
    expect(await authenticate(store, clock, auth(fresh))).toMatchObject({ status: 401 });
  });

  it('rate limit -> 429 within the minute, resets the next minute', async () => {
    const { store, clock } = demo();
    const t = await issueToken(store, clock, ME.accountId);
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i++) expect((await authenticate(store, clock, auth(t))).ok).toBe(true);
    expect(await authenticate(store, clock, auth(t))).toMatchObject({ ok: false, status: 429 });
    clock.advance(60_000);
    expect((await authenticate(store, clock, auth(t))).ok).toBe(true);
  });

  it('header lookup is case-insensitive', async () => {
    const { store, clock } = demo();
    const t = await issueToken(store, clock, ME.accountId);
    expect((await authenticate(store, clock, { Authorization: [`Bearer ${t}`] })).ok).toBe(true);
  });

  it('validates the request body', () => {
    expect(parseSiriBody('{"text":"brief me","lang":"fr-FR","etaMinutes":"11"}')).toEqual({
      text: 'brief me',
      lang: 'fr-FR',
      etaMinutes: 11,
    });
    expect(parseSiriBody('{"text":"x","etaMinutes":-4}')).toEqual({ text: 'x', lang: undefined, etaMinutes: undefined });
    expect(parseSiriBody('not json')).toBeUndefined();
    expect(parseSiriBody('{"text":""}')).toBeUndefined();
    expect(parseSiriBody(JSON.stringify({ text: 'a'.repeat(1001) }))).toBeUndefined();
    expect(parseSiriBody(undefined)).toBeUndefined();
  });
});

describe('speech helpers', () => {
  it('caps at a sentence boundary', () => {
    const long = Array.from({ length: 30 }, (_, i) => `Sentence number ${i}.`).join(' ');
    const out = capWords(long, 10);
    expect(out).toBe('Sentence number 0. Sentence number 1. Sentence number 2.');
  });
  it('guardrail drops LLM text that invents an issue key', () => {
    const allowed = new Set(['MP-42']);
    expect(guardPhrase('MP-42 is blocked.', allowed)).toBe('MP-42 is blocked.');
    expect(guardPhrase('MP-42 and MP-77 are blocked.', allowed)).toBeNull();
    expect(guardPhrase('word '.repeat(61), allowed)).toBeNull();
    expect(guardPhrase('', allowed)).toBeNull();
  });
  it('detects language, explicit hint wins', () => {
    expect(detectLang('brief me')).toBe('en');
    expect(detectLang("j'ai fini le ticket")).toBe('fr');
    expect(detectLang('ما هي مهامي')).toBe('ar');
    expect(detectLang('brief me', 'ar-SA')).toBe('ar');
  });
});

void NOW;
