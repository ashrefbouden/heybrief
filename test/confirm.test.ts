import { describe, expect, it } from 'vitest';
import {
  classifyReply,
  CONFIRM_TTL_SECONDS,
  getPending,
  listReceipts,
  propose,
  resolvePending,
  undoReceipt,
} from '../src/engine/confirm';
import { pickTransition } from '../src/engine/execute';
import type { Op } from '../src/engine/types';
import { demo, ME } from './helpers';

const DONE_12: Op[] = [{ type: 'transition', issueKey: 'MP-12', toCategory: 'done', preferStatus: 'Done' }];

describe('classifyReply', () => {
  it.each([
    'yes',
    'Yes please',
    'yeah do it',
    'ok',
    'go ahead',
    'Hey Siri, yes',
    'oui',
    'Oui, vas-y',
    "d'accord",
    'نعم',
    'تمام',
    'موافق',
  ])('%s is yes', (s) => expect(classifyReply(s)).toBe('yes'));
  it.each(['no', 'cancel', 'not yet', 'yes... no wait', 'non', 'annule', 'لا', 'إلغاء'])('%s is no', (s) =>
    expect(classifyReply(s)).toBe('no'),
  );
  it.each(['', 'what about lunch', 'maybe', 'yesterday was fine'])('%s is other', (s) => expect(classifyReply(s)).toBe('other'));
});

describe('pending action gate', () => {
  it('expires after 2 minutes and writes nothing', async () => {
    const { deps, clock, jira } = demo();
    const p = await propose(deps, { accountId: ME.accountId, kind: 'talkback', ops: DONE_12, heard: 'x', readback: 'y' });
    clock.advance(CONFIRM_TTL_SECONDS * 1000 + 1);
    const r = await resolvePending(deps, { accountId: ME.accountId, reply: 'yes', lang: 'en', pendingId: p.id });
    expect(r.status).toBe('nothing'); // store TTL already dropped it
    expect(jira.writes()).toEqual([]);
  });

  it('checks expiry against the clock even if the store kept the value', async () => {
    const { deps, clock, jira, store } = demo();
    const p = await propose(deps, { accountId: ME.accountId, kind: 'talkback', ops: DONE_12, heard: 'x', readback: 'y' });
    await store.set(`pending:${ME.accountId}`, p); // no TTL: simulate a store that keeps it longer
    clock.advance(CONFIRM_TTL_SECONDS * 1000 + 1);
    const r = await resolvePending(deps, { accountId: ME.accountId, reply: 'yes', lang: 'en', pendingId: p.id });
    expect(r.status).toBe('expired');
    expect(jira.writes()).toEqual([]);
  });

  it('runs once even if yes arrives twice', async () => {
    const { deps, jira } = demo();
    const p = await propose(deps, { accountId: ME.accountId, kind: 'talkback', ops: DONE_12, heard: 'x', readback: 'y' });
    const [a, b] = await Promise.all([
      resolvePending(deps, { accountId: ME.accountId, reply: 'yes', lang: 'en', pendingId: p.id }),
      resolvePending(deps, { accountId: ME.accountId, reply: 'yes', lang: 'en', pendingId: p.id }),
    ]);
    expect([a.status, b.status].sort()).toEqual(['expired', 'saved']);
    expect(jira.calls.filter((c) => c.method === 'transition')).toHaveLength(1);
  });

  it('rejects a confirmation id that does not match', async () => {
    const { deps, jira } = demo();
    await propose(deps, { accountId: ME.accountId, kind: 'talkback', ops: DONE_12, heard: 'x', readback: 'y' });
    const r = await resolvePending(deps, { accountId: ME.accountId, reply: 'yes', lang: 'en', pendingId: 'forged' });
    expect(r.status).toBe('mismatch');
    expect(jira.writes()).toEqual([]);
  });

  it('a pending action belongs to one user', async () => {
    const { deps, jira } = demo();
    const p = await propose(deps, { accountId: ME.accountId, kind: 'talkback', ops: DONE_12, heard: 'x', readback: 'y' });
    const r = await resolvePending(deps, { accountId: 'someone-else', reply: 'yes', lang: 'en', pendingId: p.id });
    expect(r.status).toBe('nothing');
    expect(jira.writes()).toEqual([]);
  });

  it('a new proposal replaces the old one', async () => {
    const { deps } = demo();
    const a = await propose(deps, { accountId: ME.accountId, kind: 'talkback', ops: DONE_12, heard: 'a', readback: 'a' });
    const b = await propose(deps, { accountId: ME.accountId, kind: 'talkback', ops: DONE_12, heard: 'b', readback: 'b' });
    expect((await getPending(deps, ME.accountId))?.id).toBe(b.id);
    const r = await resolvePending(deps, { accountId: ME.accountId, reply: 'yes', lang: 'en', pendingId: a.id });
    expect(r.status).toBe('mismatch');
  });

  it('re-checks permission at execute time', async () => {
    const { deps, jira } = demo();
    const p = await propose(deps, { accountId: ME.accountId, kind: 'talkback', ops: DONE_12, heard: 'x', readback: 'y' });
    jira.denyEdit.set(ME.accountId, new Set(['MP-12'])); // permission removed during the 2 minutes
    const r = await resolvePending(deps, { accountId: ME.accountId, reply: 'yes', lang: 'en', pendingId: p.id });
    expect(r.status).toBe('partial');
    expect(jira.issues.get('MP-12')!.status).toBe('In Progress');
  });

  it('reports partial failure and keeps going', async () => {
    const { deps, jira } = demo();
    jira.failOn.add('addComment');
    const ops: Op[] = [...DONE_12, { type: 'comment', issueKey: 'MP-12', body: 'x' }];
    await propose(deps, { accountId: ME.accountId, kind: 'talkback', ops, heard: 'x', readback: 'y' });
    const r = await resolvePending(deps, { accountId: ME.accountId, reply: 'yes', lang: 'en' });
    expect(r.status).toBe('partial');
    expect(r.speech).toBe('Saved 1, 1 failed. Check the receipt.');
    expect(jira.issues.get('MP-12')!.status).toBe('Done');
  });
});

describe('drive receipt and undo', () => {
  it('records a receipt and undoes transitions, flags and assignments', async () => {
    const { deps, jira } = demo();
    const ops: Op[] = [
      { type: 'transition', issueKey: 'MP-15', toCategory: 'inprogress', preferStatus: 'Blocked' },
      { type: 'flag', issueKey: 'MP-15', flagged: true },
      { type: 'assign', issueKey: 'MP-30', accountId: ME.accountId },
    ];
    await propose(deps, { accountId: ME.accountId, kind: 'talkback', ops, heard: 'heard', readback: 'rb' });
    await resolvePending(deps, { accountId: ME.accountId, reply: 'yes', lang: 'en' });

    const [receipt] = await listReceipts(deps, ME.accountId);
    expect(receipt.heard).toBe('heard');
    expect(receipt.results.every((r) => r.ok)).toBe(true);

    await undoReceipt(deps, ME.accountId, receipt.id);
    expect(jira.issues.get('MP-15')!.status).toBe('In Progress');
    expect(jira.issues.get('MP-15')!.flagged).toBe(false);
    expect(jira.issues.get('MP-30')!.assignee?.accountId).toBe('demo-yasmine');
    await expect(undoReceipt(deps, ME.accountId, receipt.id)).rejects.toThrow('already undone');
  });
});

describe('pickTransition', () => {
  const ts = [
    { id: '1', name: 'Start', toStatus: 'In Progress', toCategory: 'inprogress' as const },
    { id: '2', name: 'Block', toStatus: 'Blocked', toCategory: 'inprogress' as const },
    { id: '3', name: 'Close', toStatus: 'Closed', toCategory: 'done' as const },
  ];
  it('prefers the named status', () =>
    expect(
      pickTransition(ts, { type: 'transition', issueKey: 'X-1', toCategory: 'inprogress', preferStatus: 'Blocked' })?.id,
    ).toBe('2'));
  it('falls back to the category, never to Blocked', () =>
    expect(pickTransition(ts, { type: 'transition', issueKey: 'X-1', toCategory: 'done', preferStatus: 'Done' })?.id).toBe('3'));
  it('returns nothing when a Blocked status does not exist', () =>
    expect(
      pickTransition(ts.slice(0, 1), { type: 'transition', issueKey: 'X-1', toCategory: 'inprogress', preferStatus: 'Blocked' }),
    ).toBeUndefined());
});
