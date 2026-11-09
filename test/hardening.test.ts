import { describe, expect, it } from 'vitest';
import { MAX_CONFIRMED_PER_HOUR, propose, resolvePending } from '../src/engine/confirm';
import { HeyBrief } from '../src/engine/heybrief';
import { PermissionChecker, type PermissionHttp, type PermissionName } from '../src/engine/permissions';
import type { Op } from '../src/engine/types';
import { demo, ME } from './helpers';

function fakeHttp(opts: {
  bulkStatus?: number;
  bulkThrows?: boolean;
  grants: Record<string, PermissionName[]>;
  userHasThrows?: boolean;
}) {
  const calls: string[] = [];
  const ids: Record<string, number> = { 'MP-1': 1, 'MP-2': 2, 'OPS-3': 3 };
  const http: PermissionHttp = {
    idOf: async (k) => ids[k],
    bulk: async (_a, issueIds, perms) => {
      calls.push('bulk');
      if (opts.bulkThrows) throw new Error('network');
      if (opts.bulkStatus) return { ok: false, status: opts.bulkStatus };
      const granted = new Map<PermissionName, Set<number>>();
      for (const p of perms)
        granted.set(
          p,
          new Set(issueIds.filter((id) => (opts.grants[Object.keys(ids).find((k) => ids[k] === id)!] ?? []).includes(p))),
        );
      return { ok: true, granted };
    },
    userHas: async (_a, perms, target) => {
      const t = 'issueKey' in target ? target.issueKey : target.projectKey;
      calls.push(`userHas:${t}`);
      if (opts.userHasThrows) throw new Error('boom');
      const key = 'issueKey' in target ? target.issueKey : Object.keys(ids).find((k) => k.startsWith(target.projectKey + '-'))!;
      return perms.every((p) => (opts.grants[key] ?? []).includes(p));
    },
  };
  return { http, calls };
}

describe('Siri permission checks', () => {
  it('uses the bulk check and requires every permission', async () => {
    const { http, calls } = fakeHttp({ grants: { 'MP-1': ['EDIT_ISSUES', 'TRANSITION_ISSUES'], 'MP-2': ['EDIT_ISSUES'] } });
    const pc = new PermissionChecker(http);
    expect(await pc.allowed('u', ['MP-1', 'MP-2'], ['EDIT_ISSUES', 'TRANSITION_ISSUES'], 'write')).toEqual(new Set(['MP-1']));
    expect(calls).toEqual(['bulk']);
    expect(pc.strategy).toBe('bulk');
  });

  it('falls back to per-issue checks for writes when bulk is forbidden', async () => {
    const { http, calls } = fakeHttp({ bulkStatus: 403, grants: { 'MP-1': ['EDIT_ISSUES', 'TRANSITION_ISSUES'] } });
    const pc = new PermissionChecker(http);
    expect(await pc.allowed('u', ['MP-1', 'MP-2'], ['EDIT_ISSUES', 'TRANSITION_ISSUES'], 'write')).toEqual(new Set(['MP-1']));
    expect(pc.strategy).toBe('fallback');
    expect(calls).toEqual(['bulk', 'userHas:MP-1', 'userHas:MP-2']);
    // stays on the fallback: no second bulk attempt
    await pc.allowed('u', ['MP-1'], ['EDIT_ISSUES'], 'write');
    expect(calls.filter((c) => c === 'bulk')).toHaveLength(1);
  });

  it('fallback reads check once per project and cache it', async () => {
    const { http, calls } = fakeHttp({ bulkStatus: 401, grants: { 'MP-1': ['BROWSE_PROJECTS'] } });
    const pc = new PermissionChecker(http);
    expect(await pc.allowed('u', ['MP-1', 'MP-2', 'OPS-3'], ['BROWSE_PROJECTS'], 'read')).toEqual(new Set(['MP-1', 'MP-2']));
    await pc.allowed('u', ['MP-1'], ['BROWSE_PROJECTS'], 'read');
    expect(calls.filter((c) => c.startsWith('userHas'))).toEqual(['userHas:MP', 'userHas:OPS']);
  });

  it('fails closed on other errors', async () => {
    expect(
      await new PermissionChecker(fakeHttp({ bulkStatus: 500, grants: { 'MP-1': ['BROWSE_PROJECTS'] } }).http).allowed(
        'u',
        ['MP-1'],
        ['BROWSE_PROJECTS'],
        'read',
      ),
    ).toEqual(new Set());
    expect(
      await new PermissionChecker(fakeHttp({ bulkThrows: true, grants: { 'MP-1': ['BROWSE_PROJECTS'] } }).http).allowed(
        'u',
        ['MP-1'],
        ['BROWSE_PROJECTS'],
        'read',
      ),
    ).toEqual(new Set());
    expect(
      await new PermissionChecker(
        fakeHttp({ bulkStatus: 403, userHasThrows: true, grants: { 'MP-1': ['EDIT_ISSUES'] } }).http,
      ).allowed('u', ['MP-1'], ['EDIT_ISSUES'], 'write'),
    ).toEqual(new Set());
  });

  it('unknown issues are never allowed', async () => {
    const { http } = fakeHttp({ grants: {} });
    expect(await new PermissionChecker(http).allowed('u', ['NOPE-9'], ['BROWSE_PROJECTS'], 'read')).toEqual(new Set());
  });
});

describe('write budget', () => {
  it(`refuses after ${MAX_CONFIRMED_PER_HOUR} confirmed batches in an hour`, async () => {
    const { deps, jira, clock } = demo();
    const op: Op[] = [{ type: 'comment', issueKey: 'MP-12', body: 'x' }];
    for (let i = 0; i < MAX_CONFIRMED_PER_HOUR; i++) {
      await propose(deps, { accountId: ME.accountId, kind: 'talkback', ops: op, heard: '', readback: '' });
      expect((await resolvePending(deps, { accountId: ME.accountId, reply: 'yes', lang: 'en' })).status).toBe('saved');
    }
    await propose(deps, { accountId: ME.accountId, kind: 'talkback', ops: op, heard: '', readback: '' });
    const r = await resolvePending(deps, { accountId: ME.accountId, reply: 'yes', lang: 'en' });
    expect(r.speech).toMatch(/paused writes/);
    expect(jira.comments).toHaveLength(MAX_CONFIRMED_PER_HOUR);
    clock.advance(3_600_000);
    await propose(deps, { accountId: ME.accountId, kind: 'talkback', ops: op, heard: '', readback: '' });
    expect((await resolvePending(deps, { accountId: ME.accountId, reply: 'yes', lang: 'en' })).status).toBe('saved');
  });
});

describe('routing edge cases', () => {
  it('"why?" after a risk keeps the proposed fix, then yes applies it', async () => {
    const { deps, jira } = demo();
    const hb = new HeyBrief(deps, { projectKeys: ['MP'] });
    await hb.route(ME.accountId, "what's at risk?");
    expect((await hb.route(ME.accountId, 'why?')).speech).toContain('blocked 6 days');
    expect((await hb.route(ME.accountId, 'yes')).speech).toMatch(/^Done\./);
    expect(jira.calls.some((c) => c.method === 'createIssue')).toBe(true);
  });

  it('numbers in normal speech are not issue keys', async () => {
    const { deps } = demo();
    const a = await new HeyBrief(deps, { projectKeys: ['MP'] }).route(ME.accountId, 'what do I have in 3 hours', {
      etaMinutes: 11,
    });
    expect(a.speech).toMatch(/^You have 11 minutes/);
  });

  it('empty speech gets help, not an error', async () => {
    const { deps } = demo();
    expect((await new HeyBrief(deps).route(ME.accountId, '   ')).speech).toMatch(/^Say brief me/);
  });

  it('refuses more than 6 issues in one update', async () => {
    const { deps, jira } = demo();
    const a = await new HeyBrief(deps, { projectKeys: ['MP'] }).talkback(
      ME.accountId,
      'I finished MP-9, MP-12, MP-15, MP-20, MP-21, MP-22 and MP-23',
    );
    expect(a.speech).toBe('I can take up to 6 issues at once. Say the first 6.');
    expect(a.pendingId).toBeUndefined();
    expect(jira.writes()).toEqual([]);
  });

  it('safely() turns a crash into spoken error and a hang into the slow message', async () => {
    const { deps } = demo();
    const hb = new HeyBrief(deps);
    const err = await hb.safely('fr', async () => {
      throw new Error('jira down');
    });
    expect(err).toMatchObject({ failed: 'error', speech: expect.stringMatching(/^HeyBrief n’a pas pu joindre Jira/) });
    const slow = await hb.safely('en', () => new Promise(() => {}), 10);
    expect(slow).toMatchObject({ failed: 'timeout', speech: expect.stringMatching(/^Jira is slow/) });
  });

  it('a Jira failure while planning never leaves a pending write', async () => {
    const { deps, jira, store } = demo();
    jira.failOn.add('getIssue');
    const hb = new HeyBrief(deps, { projectKeys: ['MP'] });
    const a = await hb.safely('en', () => hb.talkback(ME.accountId, 'I finished MP-12'));
    expect(a.failed).toBe('error');
    expect(await store.get(`pending:${ME.accountId}`)).toBeUndefined();
  });
});
