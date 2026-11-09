import { describe, expect, it } from 'vitest';
import { HeyBrief } from '../src/engine/heybrief';
import { wordCount } from '../src/engine/speak';
import { parseUpdate } from '../src/engine/talkback/parse';
import { planTalkback } from '../src/engine/talkback/plan';
import { demo, ME } from './helpers';

const JUDGE = "I finished MP-12, MP-15 is blocked on legal, I'll pick up MP-9 today";

describe('planTalkback', () => {
  it('plans the judge script without writing anything', async () => {
    const { jira } = demo();
    const plan = await planTalkback(parseUpdate(JUDGE, { projectKeys: ['MP'] }), { jira, accountId: ME.accountId });
    expect(plan.changeCount).toBe(3);
    expect(jira.writes()).toEqual([]);
    expect(plan.ops.map((o) => o.type)).toEqual([
      'transition',
      'comment', // MP-12 done
      'transition',
      'flag',
      'comment',
      'notify', // MP-15 blocked, Sami told
      'transition',
      'comment', // MP-9 started (already mine, so no assign)
      'standup-page',
    ]);
  });

  it('reads back every change and ends with the yes prompt, under 60 words', async () => {
    const { jira } = demo();
    const plan = await planTalkback(parseUpdate(JUDGE, { projectKeys: ['MP'] }), { jira, accountId: ME.accountId });
    expect(plan.readback).toMatch(/^3 changes\./);
    expect(plan.readback).toContain('MP-12 to Done');
    expect(plan.readback).toContain('MP-15 to Blocked: legal');
    expect(plan.readback).toContain("I'll tell Sami");
    expect(plan.readback).toContain('MP-9 to In Progress');
    expect(plan.readback.endsWith('Say yes to save.')).toBe(true);
    expect(wordCount(plan.readback)).toBeLessThanOrEqual(60);
  });

  it('assigns to the speaker when they pick up someone else’s issue', async () => {
    const { jira } = demo();
    const plan = await planTalkback(parseUpdate("I'll pick up MP-30", { projectKeys: ['MP'] }), {
      jira,
      accountId: ME.accountId,
    });
    expect(plan.ops).toContainEqual({ type: 'assign', issueKey: 'MP-30', accountId: ME.accountId });
    expect(plan.readback).toContain('assigned to you');
  });

  it('refuses issues the speaker cannot edit', async () => {
    const { jira } = demo();
    jira.denyEdit.set(ME.accountId, new Set(['MP-12']));
    const plan = await planTalkback(parseUpdate('I finished MP-12', { projectKeys: ['MP'] }), { jira, accountId: ME.accountId });
    expect(plan.changeCount).toBe(0);
    expect(plan.readback).toContain("Can't change MP-12: you lack permission");
  });

  it('reports unknown issues', async () => {
    const { jira } = demo();
    const plan = await planTalkback(parseUpdate('I finished MP-999', { projectKeys: ['MP'] }), { jira, accountId: ME.accountId });
    expect(plan.changeCount).toBe(0);
    expect(plan.readback).toContain('not found');
  });

  it('links the blocker and notifies its assignee when the reason is an issue', async () => {
    const { jira } = demo();
    const plan = await planTalkback(parseUpdate('MP-15 is blocked by MP-38', { projectKeys: ['MP'] }), {
      jira,
      accountId: ME.accountId,
    });
    expect(plan.ops).toContainEqual({ type: 'link-blocks', blockerKey: 'MP-38', blockedKey: 'MP-15' });
    expect(plan.ops).toContainEqual(expect.objectContaining({ type: 'notify', accountIds: ['demo-omar'] }));
  });

  it('says so when an issue is already done', async () => {
    const { jira } = demo();
    const plan = await planTalkback(parseUpdate('I finished MP-5', { projectKeys: ['MP'] }), { jira, accountId: ME.accountId });
    expect(plan.changeCount).toBe(0);
    expect(plan.readback).toContain('MP-5 is already Done');
  });

  it('reads back in French', async () => {
    const { jira } = demo();
    const plan = await planTalkback(parseUpdate("J'ai terminé MP-12", { projectKeys: ['MP'] }), {
      jira,
      accountId: ME.accountId,
    });
    expect(plan.readback).toContain('MP-12 passe à Terminé');
    expect(plan.readback).toContain('Dites oui pour enregistrer.');
  });

  it('reads back in Arabic', async () => {
    const { jira } = demo();
    const plan = await planTalkback(parseUpdate('أنهيت MP-12', { projectKeys: ['MP'] }), { jira, accountId: ME.accountId });
    expect(plan.readback).toContain('MP-12 إلى منجز');
    expect(plan.readback).toContain('قل نعم للحفظ.');
  });
});

describe('talk-back standup end to end (judge script step 6)', () => {
  it('writes only after yes, and every change lands', async () => {
    const { deps, jira, confluence } = demo();
    const hb = new HeyBrief(deps, { projectKeys: ['MP'] });

    const proposed = await hb.talkback(ME.accountId, JUDGE);
    expect(proposed.expectReply).toBe(true);
    expect(proposed.pendingId).toBeDefined();
    expect(jira.writes()).toEqual([]);

    const done = await hb.confirm(ME.accountId, 'yes', proposed.pendingId);
    expect(done.speech).toBe('Done. 3 changes saved.');

    expect(jira.issues.get('MP-12')!.status).toBe('Done');
    expect(jira.issues.get('MP-15')!.status).toBe('Blocked');
    expect(jira.issues.get('MP-15')!.flagged).toBe(true);
    expect(jira.issues.get('MP-9')!.status).toBe('In Progress');
    expect(jira.comments.filter((c) => c.key === 'MP-15')[0].body).toMatch(
      /^Blocked: legal\. \(via HeyBrief voice update, confirmed by \[~accountid:me-1\]\)$/,
    );
    expect(jira.calls.some((c) => c.method === 'notify' && (c.args[1] as string[])[0] === 'demo-sami')).toBe(true);
    expect([...confluence.pages.values()][0]).toHaveLength(3);
  });

  it('anything but yes cancels and writes nothing', async () => {
    const { deps, jira } = demo();
    const hb = new HeyBrief(deps, { projectKeys: ['MP'] });
    const p = await hb.talkback(ME.accountId, JUDGE);
    const r = await hb.confirm(ME.accountId, 'hmm, what about lunch', p.pendingId);
    expect(r.speech).toBe('Cancelled. Nothing was changed.');
    expect(jira.writes()).toEqual([]);
  });
});
