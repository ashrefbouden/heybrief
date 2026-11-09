import { describe, expect, it } from 'vitest';
import { listReceiptViews, propose, resolvePending, undoReceipt } from '../src/engine/confirm';
import { applyDemoHistory, DEMO_LABEL, seedDemo, type SeedPort } from '../src/engine/demo/seed';
import { HeyBrief } from '../src/engine/heybrief';
import { runRadar } from '../src/engine/risk/radar';
import { FakeJira, FixedClock } from '../src/engine/testing/fakes';
import type { Issue, Op, Person } from '../src/engine/types';
import { demo, ME, NOW } from './helpers';

/** A SeedPort over FakeJira that honours the simulated-history property like the Forge adapter. */
function fakeSite(users: Person[], opts: { noBlocked?: boolean } = {}) {
  const clock = new FixedClock(NOW);
  const jira = new FakeJira([], clock, [ME, ...users]);
  const props = new Map<string, any>();
  const labels = new Map<string, string[]>();
  let n = 100;
  const port: SeedPort = {
    findDemoIssues: async () => [...labels.entries()].filter(([, l]) => l.includes(DEMO_LABEL)).map(([k]) => k),
    assignableUsers: async () => [ME, ...users],
    createIssue: async (i) => {
      const key = `${i.projectKey}-${++n}`;
      const now = clock.now().toISOString();
      jira.issues.set(key, {
        key,
        projectKey: i.projectKey,
        summary: i.summary,
        status: 'To Do',
        statusCategory: 'todo',
        statusChangedAt: now,
        updatedAt: now,
        priority: i.priority,
        flagged: false,
        blocks: [],
        blockedBy: [],
        assignee: [ME, ...users].find((p) => p.accountId === i.assigneeId),
        reporter: ME,
        dueDate: i.dueDate,
        epicKey: i.parentKey,
      });
      labels.set(key, i.labels);
      return key;
    },
    transitionTo: async (key, status) => {
      if (opts.noBlocked && status === 'Blocked') return false;
      const t = (await jira.getTransitions(key)).find((x) => x.toStatus === status);
      if (!t) return false;
      await jira.transition(key, t.id);
      return true;
    },
    setFlag: (k, f) => jira.setFlag(k, f),
    linkBlocks: (a, b) => jira.linkBlocks(a, b),
    setProperty: async (k, _p, v) => void props.set(k, v),
  };
  /** What the Forge adapter would return: real issue with simulated ages applied. */
  const read = (): Issue[] => [...jira.issues.values()].map((i) => ({ ...i, ...applyDemoHistory(i, props.get(i.key)) }));
  return { port, jira, read, clock };
}

const TEAM: Person[] = [
  { accountId: 'u-saif', displayName: 'Saif B' },
  { accountId: 'u-pilot1', displayName: 'Pilot One' },
  { accountId: 'u-pilot2', displayName: 'Pilot Two' },
  { accountId: 'u-pilot3', displayName: 'Pilot Three' },
];

describe('demo seeder on a real site', () => {
  it('creates the same story with real keys and gives the judge script', async () => {
    const site = fakeSite(TEAM);
    const r = await seedDemo(site.port, { projectKey: 'HB', me: ME, now: NOW });
    expect(r.alreadyLoaded).toBe(false);
    expect(Object.keys(r.keys)).toHaveLength(14);
    expect(r.script.talkback).toBe(
      `I finished ${r.keys[12]}, ${r.keys[15]} is blocked on legal, I'll pick up ${r.keys[9]} today`,
    );
    expect(r.people).toEqual({
      'Sami Haddad': 'Saif B',
      'Lina Mansour': 'Pilot One',
      'Omar Benali': 'Pilot Two',
      'Yasmine Taleb': 'Pilot Three',
    });
    expect(r.expectedRisks).toBe(3);
  });

  it('Risk Radar finds the three designed risks thanks to simulated history', async () => {
    const site = fakeSite(TEAM);
    const r = await seedDemo(site.port, { projectKey: 'HB', me: ME, now: NOW });
    const risks = runRadar(site.read(), NOW, ME.accountId);
    expect(risks.map((x) => x.rootKey)).toEqual([r.keys[42], r.keys[21], r.keys[38]]);
    expect(risks[0].signals[0].rule).toBe('blocked 6 days (threshold 3)');
  });

  it('simulated history stops applying once the issue really changes', () => {
    const sim = { seededAt: NOW.toISOString(), statusChangedAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-15T00:00:00Z' };
    const untouched = { statusChangedAt: NOW.toISOString(), updatedAt: NOW.toISOString() };
    expect(applyDemoHistory(untouched, sim)).toEqual({ statusChangedAt: sim.statusChangedAt, updatedAt: sim.updatedAt });
    const later = new Date(NOW.getTime() + 3_600_000).toISOString();
    expect(applyDemoHistory({ statusChangedAt: later, updatedAt: later }, sim)).toEqual({
      statusChangedAt: later,
      updatedAt: later,
    });
    expect(applyDemoHistory(untouched, undefined)).toEqual(untouched);
  });

  it('refuses to seed twice', async () => {
    const site = fakeSite(TEAM);
    await seedDemo(site.port, { projectKey: 'HB', me: ME, now: NOW });
    const again = await seedDemo(site.port, { projectKey: 'HB', me: ME, now: NOW });
    expect(again.alreadyLoaded).toBe(true);
    expect(site.jira.issues.size).toBe(14);
  });

  it('works alone: two risks and a clear note', async () => {
    const site = fakeSite([]);
    const r = await seedDemo(site.port, { projectKey: 'HB', me: ME, now: NOW });
    expect(r.expectedRisks).toBe(2);
    expect(r.notes.join(' ')).toMatch(/Overload risk needs at least one teammate/);
    expect(runRadar(site.read(), NOW, ME.accountId)).toHaveLength(2);
  });

  it('falls back to In Progress + flag when the workflow has no Blocked status', async () => {
    const site = fakeSite(TEAM, { noBlocked: true });
    const r = await seedDemo(site.port, { projectKey: 'HB', me: ME, now: NOW });
    const blocked = site.jira.issues.get(r.keys[42])!;
    expect(blocked.status).toBe('In Progress');
    expect(blocked.flagged).toBe(true);
    expect(r.notes.some((x) => x.includes('No "Blocked" status'))).toBe(true);
    expect(runRadar(site.read(), NOW, ME.accountId)[0].rootKey).toBe(r.keys[42]);
  });

  it('rejects a bad project key before touching Jira', async () => {
    const site = fakeSite(TEAM);
    await expect(seedDemo(site.port, { projectKey: 'hb"; DROP', me: ME, now: NOW })).rejects.toThrow('invalid project key');
    expect(site.jira.issues.size).toBe(0);
  });
});

describe('drive receipt view', () => {
  it('shows one plain line per change and hides audit comments', async () => {
    const { deps } = demo();
    const hb = new HeyBrief(deps, { projectKeys: ['MP'] });
    const p = await hb.talkback(ME.accountId, "I finished MP-12, MP-15 is blocked on legal, I'll pick up MP-9 today");
    await hb.confirm(ME.accountId, 'yes', p.pendingId);
    const [v] = await listReceiptViews(deps, ME.accountId);
    expect(v.lines.map((l) => l.text)).toEqual([
      'MP-12 moved to Done',
      'MP-15 moved to Blocked',
      'MP-15 flagged',
      'Owner notified about MP-15',
      'MP-9 moved to In Progress',
      'Standup note added in Confluence (3 lines)',
    ]);
    expect(v.canUndo).toBe(true);
    await undoReceipt(deps, ME.accountId, v.id);
    expect((await listReceiptViews(deps, ME.accountId))[0]).toMatchObject({ undone: true, canUndo: false });
  });

  it('a lone note shows as a comment line', async () => {
    const { deps } = demo();
    const ops: Op[] = [{ type: 'comment', issueKey: 'MP-12', body: 'x' }];
    await propose(deps, { accountId: ME.accountId, kind: 'talkback', ops, heard: 'note', readback: '' });
    await resolvePending(deps, { accountId: ME.accountId, reply: 'yes', lang: 'en' });
    expect((await listReceiptViews(deps, ME.accountId))[0].lines.map((l) => l.text)).toEqual(['Comment on MP-12']);
  });
});

describe('gadget risk fix (two clicks)', () => {
  it('scanning risks does not clobber a pending Siri write', async () => {
    const { deps, jira } = demo();
    const hb = new HeyBrief(deps, { projectKeys: ['MP'] });
    const p = await hb.talkback(ME.accountId, 'I finished MP-12');
    await hb.scanRisks(ME.accountId, { kind: 'me', accountId: ME.accountId });
    await hb.confirm(ME.accountId, 'yes', p.pendingId);
    expect(jira.issues.get('MP-12')!.status).toBe('Done');
  });

  it('propose then confirm applies the chosen risk fix', async () => {
    const { deps, jira } = demo();
    const hb = new HeyBrief(deps);
    await hb.scanRisks(ME.accountId, { kind: 'me', accountId: ME.accountId });
    const p = await hb.proposeRiskFix(ME.accountId, 2);
    expect(p.speech).toBe('MP-21: Want me to reassign MP-21 to Lina?');
    expect(jira.writes()).toEqual([]);
    await hb.confirm(ME.accountId, 'yes', p.pendingId);
    expect(jira.issues.get('MP-21')!.assignee?.accountId).toBe('demo-lina');
  });
});
