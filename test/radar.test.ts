import { describe, expect, it } from 'vitest';
import { DEFAULT_RADAR, downstream, findOverloads, issueSignals, runRadar } from '../src/engine/risk/radar';
import { explainRisk, speakRadar } from '../src/engine/risk/speak';
import { wordCount } from '../src/engine/speak';
import type { Issue } from '../src/engine/types';
import { demo, ME, NOW } from './helpers';

const DAY = 86_400_000;
const ago = (d: number) => new Date(NOW.getTime() - d * DAY).toISOString();
const inDays = (d: number) => new Date(NOW.getTime() + d * DAY).toISOString().slice(0, 10);

function issue(p: Partial<Issue> & { key: string }): Issue {
  return {
    projectKey: 'X',
    summary: p.key,
    status: 'In Progress',
    statusCategory: 'inprogress',
    statusChangedAt: ago(1),
    updatedAt: ago(0),
    priority: 'Medium',
    flagged: false,
    blocks: [],
    blockedBy: [],
    ...p,
  };
}
const ids = (i: Issue, all: Issue[] = [i]) =>
  issueSignals(i, new Map(all.map((x) => [x.key, x])), NOW, DEFAULT_RADAR).map((s) => s.id);

describe('Risk Radar signals (one fixture each)', () => {
  it('blocked too long: fires at 3 days, not at 2', () => {
    expect(ids(issue({ key: 'X-1', status: 'Blocked', statusChangedAt: ago(3) }))).toEqual(['blocked-too-long']);
    expect(ids(issue({ key: 'X-1', status: 'Blocked', statusChangedAt: ago(2) }))).toEqual([]);
  });
  it('a flag counts as blocked', () => {
    expect(ids(issue({ key: 'X-1', flagged: true, statusChangedAt: ago(4) }))).toEqual(['blocked-too-long']);
  });
  it('blocking chain: +2 per open downstream issue, two levels, done issues ignored', () => {
    const a = issue({ key: 'X-1', status: 'Blocked', statusChangedAt: ago(1), blocks: ['X-2', 'X-4'] });
    const b = issue({ key: 'X-2', statusCategory: 'todo', status: 'To Do', blocks: ['X-3'] });
    const c = issue({ key: 'X-3', statusCategory: 'todo', status: 'To Do', blocks: ['X-5'] });
    const d = issue({ key: 'X-4', statusCategory: 'done', status: 'Done' });
    const e = issue({ key: 'X-5', statusCategory: 'todo', status: 'To Do' });
    const s = issueSignals(a, new Map([a, b, c, d, e].map((x) => [x.key, x])), NOW, DEFAULT_RADAR);
    expect(s).toEqual([expect.objectContaining({ id: 'blocking-chain', weight: 4, evidence: ['X-1', 'X-2', 'X-3'] })]);
  });
  it('downstream survives link cycles', () => {
    const a = issue({ key: 'X-1', blocks: ['X-2'] });
    const b = issue({ key: 'X-2', blocks: ['X-1'] });
    expect(downstream('X-1', new Map([a, b].map((x) => [x.key, x])), 5)).toEqual(['X-2']);
  });
  it('overdue: due yesterday and not done', () => {
    expect(ids(issue({ key: 'X-1', dueDate: inDays(-1) }))).toEqual(['overdue']);
    expect(ids(issue({ key: 'X-1', dueDate: inDays(-1), statusCategory: 'done', status: 'Done' }))).toEqual([]);
  });
  it('due soon, not started: To Do and due within 3 days', () => {
    expect(ids(issue({ key: 'X-1', status: 'To Do', statusCategory: 'todo', dueDate: inDays(3) }))).toEqual([
      'due-soon-not-started',
    ]);
    expect(ids(issue({ key: 'X-1', status: 'To Do', statusCategory: 'todo', dueDate: inDays(4) }))).toEqual([]);
    expect(ids(issue({ key: 'X-1', dueDate: inDays(1) }))).toEqual([]); // already started
  });
  it('stale: In Progress with no update for 7 days', () => {
    expect(ids(issue({ key: 'X-1', updatedAt: ago(7) }))).toEqual(['stale']);
    expect(ids(issue({ key: 'X-1', updatedAt: ago(6) }))).toEqual([]);
  });
  it('owner overload: more than 40% of at least 6 open issues', () => {
    const p = { accountId: 'a', displayName: 'Ana' };
    const q = { accountId: 'b', displayName: 'Bo' };
    const six = [1, 2, 3, 4, 5, 6].map((n) => issue({ key: `X-${n}`, assignee: n <= 3 ? p : q }));
    expect(findOverloads(six, DEFAULT_RADAR).map((o) => o.person.displayName)).toEqual(['Ana', 'Bo']);
    expect(findOverloads(six.slice(0, 5), DEFAULT_RADAR)).toEqual([]);
  });
});

describe('Risk Radar on demo data', () => {
  it('finds exactly three risks in a stable order', async () => {
    const { issues } = demo();
    const risks = runRadar(issues, NOW, ME.accountId);
    expect(risks.map((r) => [r.rootKey, r.score, r.label])).toEqual([
      ['MP-42', 8, 'confirmed'],
      ['MP-21', 3, 'estimated'],
      ['MP-38', 2, 'confirmed'],
    ]);
  });

  it('cites its sources: the blocked issue and both downstream issues', () => {
    const { issues } = demo();
    const [top] = runRadar(issues, NOW, ME.accountId);
    expect(top.sources).toEqual(['MP-42', 'MP-45', 'MP-51']);
    expect(top.signals.map((s) => s.rule)).toEqual([
      'blocked 6 days (threshold 3)',
      'blocked issue blocks 2 open issues (MP-45, MP-51)',
    ]);
  });

  it('proposes exactly one fix per risk', () => {
    const { issues } = demo();
    const [a, b, c] = runRadar(issues, NOW, ME.accountId);
    expect(a.fix.kind).toBe('follow-up');
    expect(a.fix.ops[0]).toMatchObject({
      type: 'create-issue',
      assigneeId: 'demo-lina',
      dueDate: '2026-11-18',
      linkToKey: 'MP-42',
    });
    expect(b.fix).toMatchObject({
      kind: 'reassign',
      ops: [expect.objectContaining({ type: 'assign', issueKey: 'MP-21', accountId: 'demo-lina' }), expect.anything()],
    });
    expect(c.fix.kind).toBe('ping-owner');
  });

  it('follow-up due date skips the weekend', () => {
    const { issues } = demo();
    const friday = new Date('2026-11-20T08:00:00Z');
    const shifted = issues.map((i) => ({ ...i }));
    const [top] = runRadar(shifted, friday, ME.accountId);
    expect(top.fix.ops[0]).toMatchObject({ dueDate: '2026-11-24' });
  });

  it('never cites an issue key that is not in the data', () => {
    const { issues } = demo();
    const known = new Set(issues.map((i) => i.key));
    for (const r of runRadar(issues, NOW, ME.accountId)) for (const k of r.sources) expect(known.has(k)).toBe(true);
  });
});

describe('Risk Radar speech', () => {
  it('speaks the top risk with label and fix, under 60 words', () => {
    const { issues } = demo();
    const s = speakRadar(runRadar(issues, NOW, ME.accountId), 'en');
    expect(s).toBe(
      '3 risks this week. Highest: MP-42 has been blocked 6 days and blocks MP-45 and MP-51, confirmed. Also: MP-21 and MP-38. Want me to create a follow-up for Lina due Wednesday?',
    );
    expect(wordCount(s)).toBeLessThanOrEqual(60);
  });
  it('says so when there are no risks', () => expect(speakRadar([], 'en')).toBe('No risks this week. Nice.'));
  it('answers why with the rule and sources', () => {
    const { issues } = demo();
    const [top] = runRadar(issues, NOW, ME.accountId);
    expect(explainRisk(top, 'en')).toBe(
      'MP-42 has been blocked 6 days and blocks MP-45 and MP-51. Rules that fired: blocked 3 days or more and a blocker holding up open work. Confirmed from Jira. Evidence: MP-42, MP-45, MP-51.',
    );
  });
  it('speaks French and Arabic', () => {
    const { issues } = demo();
    const r = runRadar(issues, NOW, ME.accountId);
    expect(speakRadar(r, 'fr')).toMatch(
      /^3 risques cette semaine\. Le plus urgent : |^3 risques cette semaine\. Le plus urgent: /,
    );
    expect(speakRadar(r, 'ar')).toContain('محظور منذ 6 أيام');
  });
});

describe('Risk Radar fixes on a real site (Nov 13 MCP run)', () => {
  const root = issue({ key: 'X-1', summary: 'Renew SSO certificate', status: 'Blocked', statusChangedAt: ago(8) });

  it('never puts an English placeholder into French or Arabic when nobody owns the issue', () => {
    const [r] = runRadar([root], NOW, ME.accountId);
    expect(r.fix.kind).toBe('follow-up');
    expect(r.fix.say.en).toMatch(/^create a follow-up task due /);
    expect(r.fix.say.fr).not.toContain('the owner');
    expect(r.fix.say.ar).not.toContain('the owner');
  });

  it('does not propose a second follow-up while one is still open: it nudges the open one', () => {
    const follow = issue({ key: 'X-9', summary: 'Unblock X-1: Renew SSO certificate', statusCategory: 'todo', status: 'To Do' });
    const [r] = runRadar([root, follow], NOW, ME.accountId);
    expect(r.rootKey).toBe('X-1');
    expect(r.fix.kind).toBe('ping-owner');
    expect(r.fix.say.en).toBe('nudge the open follow-up X-9');
    expect(r.fix.ops).toHaveLength(1);
    expect(r.fix.ops[0]).toMatchObject({ type: 'comment', issueKey: 'X-9' });
  });

  it('a done follow-up does not block a new one', () => {
    const done = issue({ key: 'X-9', summary: 'Unblock X-1: Renew SSO certificate', statusCategory: 'done', status: 'Done' });
    const [r] = runRadar([root, done], NOW, ME.accountId);
    expect(r.fix.kind).toBe('follow-up');
  });

  it('asks for a status, not a new date, when the issue is only stale', () => {
    const stale = issue({ key: 'X-2', updatedAt: ago(9) });
    const [r] = runRadar([stale], NOW, ME.accountId);
    expect(r.fix.say.en).toBe('ping the owner for a quick status');
    expect(r.fix.say.fr).toBe('demande un point rapide au responsable');
  });

  it('explains in French and Arabic without raw rule text', () => {
    const [r] = runRadar([root], NOW, ME.accountId);
    expect(explainRisk(r, 'fr')).toContain('Règles déclenchées : bloqué 3 jours ou plus');
    expect(explainRisk(r, 'ar')).toContain('مؤكد من Jira');
    expect(explainRisk(r, 'en')).not.toContain('threshold');
  });
});
