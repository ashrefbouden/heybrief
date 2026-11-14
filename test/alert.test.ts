import { describe, expect, it } from 'vitest';
import { detectAlerts } from '../src/engine/alert/detect';
import { explainAlert, speakAlert } from '../src/engine/alert/speak';
import { HeyBrief } from '../src/engine/heybrief';
import { wordCount } from '../src/engine/speak';
import { makeDeps } from '../src/engine/testing/fakes';
import type { Issue, Person } from '../src/engine/types';
import { demo, ME, NOW } from './helpers';

const MIN = 60_000;
const DAY = 86_400_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const inDays = (d: number) => new Date(NOW.getTime() + d * DAY).toISOString().slice(0, 10);
const LINA: Person = { accountId: 'lina', displayName: 'Lina Mansour' };
const SAMI: Person = { accountId: 'sami', displayName: 'Sami Haddad' };

function issue(p: Partial<Issue> & { key: string }): Issue {
  return {
    projectKey: 'X',
    summary: p.key,
    status: 'To Do',
    statusCategory: 'todo',
    statusChangedAt: ago(10 * MIN),
    updatedAt: ago(10 * MIN),
    createdAt: ago(10 * MIN),
    priority: 'Medium',
    flagged: false,
    blocks: [],
    blockedBy: [],
    reporter: SAMI,
    ...p,
  };
}
const kinds = (issues: Issue[]) => detectAlerts(issues, NOW, ME.accountId).map((a) => `${a.kind}:${a.issueKey}:${a.confidence}`);

describe('Heads-up detection', () => {
  it('Highest-priority incident nobody picked up: critical, confirmed by issue type', () => {
    const a = detectAlerts(
      [
        issue({
          key: 'X-1',
          summary: 'Checkout API returns 500',
          issueType: 'Incident',
          priority: 'Highest',
          createdAt: ago(12 * MIN),
        }),
      ],
      NOW,
      ME.accountId,
    );
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: 'incident', severity: 'critical', confidence: 'confirmed', ageMinutes: 12 });
    expect(a[0].action.kind).toBe('take');
    expect(a[0].action.ops).toEqual([
      { type: 'assign', issueKey: 'X-1', accountId: ME.accountId },
      { type: 'transition', issueKey: 'X-1', toCategory: 'inprogress' },
      expect.objectContaining({ type: 'comment', issueKey: 'X-1', mentions: [SAMI.accountId] }),
    ]);
  });

  it('keyword-only incident is labelled keyword (verify), and needs Highest priority', () => {
    expect(kinds([issue({ key: 'X-1', summary: 'Payments outage in production', priority: 'Highest' })])).toEqual([
      'incident:X-1:keyword',
    ]);
    expect(kinds([issue({ key: 'X-1', summary: 'Payments outage in production', priority: 'High' })])).toEqual([]);
  });

  it('an incident already in progress with an owner does not interrupt', () => {
    expect(
      kinds([
        issue({
          key: 'X-1',
          issueType: 'Incident',
          priority: 'Highest',
          assignee: LINA,
          status: 'In Progress',
          statusCategory: 'inprogress',
        }),
      ]),
    ).toEqual([]);
  });

  it('old backlog incidents do not interrupt (fresh window)', () => {
    expect(kinds([issue({ key: 'X-1', issueType: 'Incident', priority: 'Highest', createdAt: ago(8 * DAY) })])).toEqual([]);
  });

  it('security: label confirms, words in FR and AR are caught, owner is pinged', () => {
    expect(kinds([issue({ key: 'X-1', labels: ['security'], priority: 'High', assignee: LINA })])).toEqual([
      'security:X-1:confirmed',
    ]);
    expect(kinds([issue({ key: 'X-2', summary: 'Fuite de clés API dans le dépôt' })])).toEqual(['security:X-2:keyword']);
    expect(kinds([issue({ key: 'X-3', summary: 'ثغرة في صفحة الدخول' })])).toEqual(['security:X-3:keyword']);
    const [a] = detectAlerts([issue({ key: 'X-1', labels: ['security'], priority: 'High', assignee: LINA })], NOW, ME.accountId);
    expect(a.severity).toBe('critical');
    expect(a.action).toMatchObject({ kind: 'ping', ops: [expect.objectContaining({ mentions: [LINA.accountId] })] });
  });

  it('ordinary words do not trigger (no "security guard" style noise on normal tickets)', () => {
    expect(kinds([issue({ key: 'X-1', summary: 'Add dropdown to settings', priority: 'Highest' })])).toEqual([]);
    expect(kinds([issue({ key: 'X-2', summary: 'Write onboarding copy', priority: 'High', dueDate: inDays(3) })])).toEqual([]);
  });

  it('deadline collision: an open blocker in front of work due tomorrow; owner asked to unblock', () => {
    const blocker = issue({ key: 'X-1', status: 'Blocked', statusCategory: 'inprogress', assignee: LINA, blocks: ['X-2'] });
    const due = issue({ key: 'X-2', dueDate: inDays(1), blockedBy: ['X-1'] });
    const [a] = detectAlerts([blocker, due], NOW, ME.accountId);
    expect(a).toMatchObject({ kind: 'deadline-collision', issueKey: 'X-1', evidence: ['X-1', 'X-2'], confidence: 'confirmed' });
    expect(a.id).toBe('collision:X-1_X-2');
    expect(a.action.kind).toBe('unblock');
    expect(a.action.ops[0]).toMatchObject({ type: 'comment', issueKey: 'X-1', mentions: [LINA.accountId] });
    // Due in 3 days, or blocker already done: no alert.
    expect(kinds([blocker, { ...due, dueDate: inDays(3) }])).toEqual([]);
    expect(kinds([{ ...blocker, statusCategory: 'done', status: 'Done' }, due])).toEqual([]);
  });

  it('due today, High priority, not started: my own -> start it', () => {
    const [a] = detectAlerts([issue({ key: 'X-1', priority: 'High', dueDate: inDays(0), assignee: ME })], NOW, ME.accountId);
    expect(a).toMatchObject({ kind: 'due-today', severity: 'urgent' });
    expect(a.action.ops[0]).toEqual({ type: 'transition', issueKey: 'X-1', toCategory: 'inprogress' });
  });

  it('done issues never alert, and one alert per issue', () => {
    expect(kinds([issue({ key: 'X-1', issueType: 'Incident', priority: 'Highest', statusCategory: 'done' })])).toEqual([]);
    expect(
      kinds([issue({ key: 'X-1', issueType: 'Incident', priority: 'Highest', labels: ['security'], dueDate: inDays(0) })]),
    ).toEqual(['incident:X-1:confirmed']);
  });

  it('orders critical before urgent, confirmed before keyword', () => {
    const list = kinds([
      issue({ key: 'X-1', priority: 'High', dueDate: inDays(0) }),
      issue({ key: 'X-2', summary: 'Site is down', priority: 'Highest' }),
      issue({ key: 'X-3', issueType: 'Incident', priority: 'Highest' }),
    ]);
    expect(list).toEqual(['incident:X-3:confirmed', 'incident:X-2:keyword', 'due-today:X-1:confirmed']);
  });

  it('the demo project has no alerts, so the scripted story is unchanged', () => {
    const { issues } = demo();
    expect(detectAlerts(issues, NOW, ME.accountId)).toEqual([]);
  });
});

describe('Heads-up speech', () => {
  const inc = issue({
    key: 'X-1',
    summary: 'Checkout API down',
    issueType: 'Incident',
    priority: 'Highest',
    createdAt: ago(12 * MIN),
  });
  const [alert] = detectAlerts([inc], NOW, ME.accountId);

  it('says what, when, how sure, and asks one question, in each language, ≤ 60 words', () => {
    const en = speakAlert(alert, 'en');
    expect(en).toBe(
      "Urgent heads-up: incident. X-1, Checkout API down, opened 12 minutes ago, nobody on it. Confirmed from Jira. Want me to assign X-1 to you, start it, and tell the team you're on it?",
    );
    for (const lang of ['en', 'fr', 'ar'] as const) {
      const s = speakAlert(alert, lang, 2);
      expect(wordCount(s)).toBeLessThanOrEqual(60);
      expect(s).toContain('X-1');
      expect(s.endsWith('?') || s.endsWith('؟')).toBe(true);
    }
  });

  it('keyword alerts tell the listener to verify', () => {
    const [k] = detectAlerts([issue({ key: 'X-2', summary: 'Site is down', priority: 'Highest' })], NOW, ME.accountId);
    expect(speakAlert(k, 'en')).toContain('please verify');
    expect(speakAlert(k, 'fr')).toContain('vérifiez');
  });

  it('why? cites the rule and the evidence', () => {
    expect(explainAlert(alert, 'en')).toBe('X-1: Highest priority incident (Incident), unassigned (confirmed). Sources: X-1.');
  });
});

describe('Heads-up in the engine', () => {
  function setup(extra: Issue[]) {
    const { issues, people } = demo();
    const d = makeDeps([...issues, ...extra], NOW, people);
    return { ...d, hb: new HeyBrief(d.deps, { projectKeys: ['MP', 'X'] }) };
  }
  const p1 = issue({ key: 'X-9', summary: 'Checkout API down', issueType: 'Incident', priority: 'Highest', projectKey: 'X' });

  it('interrupts once, then stays quiet; yes assigns and comments; receipt kind is alert', async () => {
    const { hb, jira } = setup([p1]);
    const first = await hb.alerts(ME.accountId);
    expect(first.speech).toMatch(/^Urgent heads-up/);
    expect(first.pendingId).toBeDefined();

    const saved = await hb.route(ME.accountId, 'yes');
    expect(saved.speech).toMatch(/^Done/);
    expect(jira.issues.get('X-9')!.assignee?.accountId).toBe(ME.accountId);
    expect(jira.comments.at(-1)).toMatchObject({ key: 'X-9', mentions: [SAMI.accountId] });

    const again = await hb.alerts(ME.accountId);
    expect(again.speech).toBe('');
  });

  it('never interrupts while another change waits for a yes', async () => {
    const { hb } = setup([p1]);
    const t = await hb.route(ME.accountId, 'I finished MP-12');
    expect(t.pendingId).toBeDefined();
    expect((await hb.alerts(ME.accountId)).speech).toBe('');
    // The pending talk-back is untouched and the alert was not consumed.
    expect((await hb.route(ME.accountId, 'no')).speech).toMatch(/Cancelled/);
    expect((await hb.alerts(ME.accountId)).speech).toMatch(/^Urgent/);
  });

  it('two polls racing announce the alert once', async () => {
    const { hb } = setup([p1]);
    const [a, b] = await Promise.all([hb.alerts(ME.accountId), hb.alerts(ME.accountId)]);
    expect([a.speech, b.speech].filter(Boolean)).toHaveLength(1);
  });

  it('"later" snoozes without writing, and the alert comes back after the snooze', async () => {
    const { hb, jira, clock } = setup([p1]);
    await hb.alerts(ME.accountId);
    const s = await hb.route(ME.accountId, 'later');
    expect(s.speech).toMatch(/remind you in 30 minutes/);
    expect(jira.writes()).toEqual([]);
    expect((await hb.alerts(ME.accountId)).speech).toBe('');
    clock.advance(31 * MIN);
    expect((await hb.alerts(ME.accountId)).speech).toMatch(/^Urgent/);
  });

  it('"why?" after an alert explains it and keeps the yes alive', async () => {
    const { hb, jira } = setup([p1]);
    const first = await hb.alerts(ME.accountId);
    const why = await hb.route(ME.accountId, 'why?');
    expect(why.speech).toContain('Highest priority incident');
    expect(why.pendingId).toBe(first.pendingId);
    await hb.route(ME.accountId, 'yes');
    expect(jira.issues.get('X-9')!.assignee?.accountId).toBe(ME.accountId);
  });

  it('"anything urgent?" repeats a known alert, and says so when there is none', async () => {
    const { hb } = setup([p1]);
    await hb.alerts(ME.accountId);
    await hb.route(ME.accountId, 'no');
    expect((await hb.route(ME.accountId, 'Anything urgent?')).speech).toMatch(/^Urgent heads-up/);
    const quiet = setup([]);
    expect((await quiet.hb.route(ME.accountId, 'Y a-t-il des alertes ?', { lang: 'fr' })).speech).toBe(
      'Aucune alerte urgente pour l’instant.',
    );
  });

  it('counts the other new alerts so the listener knows more are queued', async () => {
    const sec = issue({ key: 'X-10', labels: ['security'], priority: 'High', projectKey: 'X' });
    const { hb } = setup([p1, sec]);
    const a = await hb.alerts(ME.accountId);
    expect(a.speech).toContain('1 more after this');
    await hb.route(ME.accountId, 'no');
    expect((await hb.alerts(ME.accountId)).speech).toMatch(/security issue/);
  });
});

describe('Heads-up hero loop: take, receipt, undo', () => {
  it('take assigns, starts and comments; undo unassigns and restores the status', async () => {
    const { makeDeps } = await import('../src/engine/testing/fakes');
    const { HeyBrief } = await import('../src/engine/heybrief');
    const { listReceiptViews, undoReceipt } = await import('../src/engine/confirm');
    const inc = issue({
      key: 'X-1',
      summary: 'Checkout API down',
      priority: 'Highest',
      issueType: 'Incident',
      createdAt: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
      reporter: SAMI,
    });
    const { deps, jira } = makeDeps([inc], NOW, [ME, SAMI]);
    const hb = new HeyBrief(deps);
    const a = await hb.alerts(ME.accountId, {});
    expect(a.changes).toEqual(['X-1 assigned to you', 'X-1 moved to In Progress']);
    await hb.confirm(ME.accountId, 'yes', a.pendingId);
    expect(jira.issues.get('X-1')).toMatchObject({ statusCategory: 'inprogress', assignee: { accountId: ME.accountId } });
    const [r] = await listReceiptViews(deps, ME.accountId);
    expect(r.kind).toBe('alert');
    const out = await undoReceipt(deps, ME.accountId, r.id);
    expect(out.every((x) => x.ok)).toBe(true);
    expect(jira.issues.get('X-1')!.assignee).toBeUndefined();
    expect(jira.issues.get('X-1')!.statusCategory).toBe('todo');
  });

  it('ping leaves only a comment, so there is nothing to undo', async () => {
    const { makeDeps } = await import('../src/engine/testing/fakes');
    const { HeyBrief } = await import('../src/engine/heybrief');
    const { listReceiptViews } = await import('../src/engine/confirm');
    const inc = issue({
      key: 'X-2',
      summary: 'Checkout API down',
      priority: 'Highest',
      issueType: 'Incident',
      createdAt: NOW.toISOString(),
      assignee: SAMI,
    });
    const { deps } = makeDeps([inc], NOW, [ME, SAMI]);
    const hb = new HeyBrief(deps);
    const a = await hb.alerts(ME.accountId, {});
    await hb.confirm(ME.accountId, 'yes', a.pendingId);
    expect((await listReceiptViews(deps, ME.accountId))[0].canUndo).toBe(false);
  });
});

describe('alert speech fixes (Nov 13 MCP run)', () => {
  it('a confirmed incident is not called "possible", and French counts the rest naturally', async () => {
    const { detectAlerts } = await import('../src/engine/alert/detect');
    const { speakAlert } = await import('../src/engine/alert/speak');
    const { ME, NOW } = await import('./helpers');
    const [a] = detectAlerts(
      [
        {
          key: 'X-7',
          projectKey: 'X',
          summary: 'Checkout API down',
          issueType: 'Incident',
          status: 'To Do',
          statusCategory: 'todo',
          statusChangedAt: NOW.toISOString(),
          updatedAt: NOW.toISOString(),
          createdAt: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
          priority: 'Highest',
          flagged: false,
          blocks: [],
          blockedBy: [],
        } as never,
      ],
      NOW,
      ME.accountId,
    );
    const fr = speakAlert(a, 'fr', 2);
    expect(fr).not.toContain('possible');
    expect(fr).toContain('Et 2 autres ensuite.');
  });
});
