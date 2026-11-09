// One-click demo data on a REAL site. Same story as demo/data.ts, created through a port.
//
// Jira can't backdate timestamps, so each issue gets a "heybrief-demo" issue property holding the
// simulated ages (e.g. "blocked 6 days ago"). The Forge adapter uses those ages only while the issue
// is untouched since seeding; the first real change brings back real timestamps. Disclosed in JUDGES.md.

import type { Person, Priority } from '../types';
import { DEMO_PEOPLE, demoRows } from './data';

export const DEMO_LABEL = 'heybrief-demo';
export const DEMO_PROPERTY = 'heybrief-demo';
const DAY = 86_400_000;

export interface DemoHistory {
  seededAt: string;
  statusChangedAt: string;
  updatedAt: string;
}

export interface SeedPort {
  /** Keys of issues in the project that already carry the demo label. */
  findDemoIssues(projectKey: string): Promise<string[]>;
  /** People who can be assigned issues in the project. */
  assignableUsers(projectKey: string): Promise<Person[]>;
  createIssue(input: {
    projectKey: string;
    summary: string;
    issueType: 'Task' | 'Epic';
    priority: Priority;
    assigneeId?: string;
    dueDate?: string;
    parentKey?: string;
    labels: string[];
  }): Promise<string>;
  /** Move to a status by name. False if the workflow has no such status. */
  transitionTo(key: string, status: string): Promise<boolean>;
  setFlag(key: string, flagged: boolean): Promise<void>;
  linkBlocks(blockerKey: string, blockedKey: string): Promise<void>;
  setProperty(key: string, property: string, value: unknown): Promise<void>;
}

export interface SeedResult {
  alreadyLoaded: boolean;
  keys: Record<number, string>;
  /** Persona -> real person it was mapped to (or undefined = left unassigned). */
  people: Record<string, string | undefined>;
  /** What the judge should say, with the real keys. */
  script: { talkback: string; risk: string };
  expectedRisks: number;
  notes: string[];
}

export async function seedDemo(port: SeedPort, input: { projectKey: string; me: Person; now: Date }): Promise<SeedResult> {
  const { projectKey, me, now } = input;
  if (!/^[A-Z][A-Z0-9_]{0,19}$/.test(projectKey)) throw new Error('invalid project key');

  const existing = await port.findDemoIssues(projectKey);
  if (existing.length) {
    return {
      alreadyLoaded: true,
      keys: {},
      people: {},
      script: { talkback: '', risk: '' },
      expectedRisks: 0,
      notes: [`Demo data is already in ${projectKey} (${existing.length} issues labelled ${DEMO_LABEL}).`],
    };
  }

  // Map the four personas onto real teammates, in order. Missing personas stay unassigned.
  const others = (await port.assignableUsers(projectKey)).filter((p) => p.accountId !== me.accountId);
  const personaOrder = ['sami', 'lina', 'omar', 'yasmine'] as const;
  const mapped = new Map<string, Person | undefined>();
  personaOrder.forEach((name, i) => mapped.set(DEMO_PEOPLE[name].accountId, others[i]));
  const realPerson = (p?: Person) => (!p ? undefined : p.accountId === me.accountId ? me : mapped.get(p.accountId));

  const rows = demoRows(me);
  const keys: Record<number, string> = {};
  const notes: string[] = [];
  const seededAt = now.toISOString();
  const iso = (daysAgo: number) => new Date(now.getTime() - daysAgo * DAY).toISOString();
  const date = (inDays: number) => new Date(now.getTime() + inDays * DAY).toISOString().slice(0, 10);

  // Parallel where Jira allows it: a resolver has about 25 seconds and this is ~60 calls.
  // Round 1: the epic (children point at it). Round 2: every other issue.
  const create = (r: (typeof rows)[number]) =>
    port.createIssue({
      projectKey,
      summary: r.summary,
      issueType: r.n === 40 ? 'Epic' : 'Task',
      priority: r.priority,
      assigneeId: realPerson(r.assignee)?.accountId,
      dueDate: r.dueInDays !== undefined ? date(r.dueInDays) : undefined,
      parentKey: r.epic ? keys[r.epic] : undefined,
      labels: [DEMO_LABEL],
    });
  for (const r of rows.filter((x) => x.n === 40)) keys[r.n] = await create(r);
  const rest = rows.filter((x) => x.n !== 40);
  (await Promise.all(rest.map(create))).forEach((k, i) => (keys[rest[i].n] = k));

  // Round 3: status, flag, links and simulated history per issue, issues in parallel.
  await Promise.all(
    rows.map(async (r) => {
      const key = keys[r.n];
      if (r.status !== 'To Do') {
        const ok = await port.transitionTo(key, r.status);
        if (!ok && r.status === 'Blocked') {
          await port.transitionTo(key, 'In Progress');
          notes.push(`No "Blocked" status in this workflow: ${key} is In Progress and flagged instead.`);
        } else if (!ok) notes.push(`Could not move ${key} to ${r.status}.`);
      }
      if (r.flagged) await port.setFlag(key, true);
      for (const b of r.blocks ?? []) await port.linkBlocks(key, keys[b]);
      const history: DemoHistory = {
        seededAt,
        statusChangedAt: iso(r.statusDaysAgo ?? 1),
        updatedAt: iso(r.updatedDaysAgo ?? Math.min(r.statusDaysAgo ?? 1, 1)),
      };
      await port.setProperty(key, DEMO_PROPERTY, history);
    }),
  );

  const people: Record<string, string | undefined> = {};
  for (const name of personaOrder) people[DEMO_PEOPLE[name].displayName] = mapped.get(DEMO_PEOPLE[name].accountId)?.displayName;

  // Which of the three designed risks will show up with the people available.
  let expectedRisks = 2; // blocked chain + overdue need nobody else
  if (mapped.get(DEMO_PEOPLE.sami.accountId)) expectedRisks = 3;
  else notes.push('Overload risk needs at least one teammate besides you: invite one, then reload the demo in a new project.');
  if (!mapped.get(DEMO_PEOPLE.lina.accountId))
    notes.push('No second teammate: the follow-up for the blocked issue will be unassigned.');

  return {
    alreadyLoaded: false,
    keys,
    people,
    script: {
      talkback: `I finished ${keys[12]}, ${keys[15]} is blocked on legal, I'll pick up ${keys[9]} today`,
      risk: "What's at risk this week?",
    },
    expectedRisks,
    notes,
  };
}

/** Use simulated history only while the issue is untouched since seeding (10 minute grace). */
export function applyDemoHistory(
  real: { statusChangedAt: string; updatedAt: string },
  sim: DemoHistory | undefined,
): { statusChangedAt: string; updatedAt: string } {
  if (!sim?.seededAt) return real;
  const limit = Date.parse(sim.seededAt) + 10 * 60_000;
  return {
    statusChangedAt: Date.parse(real.statusChangedAt) <= limit ? sim.statusChangedAt : real.statusChangedAt,
    updatedAt: Date.parse(real.updatedAt) <= limit ? sim.updatedAt : real.updatedAt,
  };
}
