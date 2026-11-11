// Deterministic demo project "MP". Dates are relative to `now`, so the same story works
// in unit tests, the offline demo, and the one-click seeder on a real site.
//
// Built so Risk Radar always finds exactly three risks:
//   1. MP-42 blocked 6 days and blocking MP-45 + MP-51 (confirmed, score 8)
//   2. Sami holds 6 of 13 open issues -> reassign MP-21 (estimated, score 3)
//   3. MP-38 two days overdue (confirmed, score 2)
// and the judge script's talk-back sentence touches MP-12, MP-15 and MP-9.

import type { Issue, Person, Priority, StatusCategory } from '../types';

export const DEMO_PROJECT = 'MP';

export const DEMO_PEOPLE = {
  sami: { accountId: 'demo-sami', displayName: 'Sami Haddad' },
  lina: { accountId: 'demo-lina', displayName: 'Lina Mansour' },
  omar: { accountId: 'demo-omar', displayName: 'Omar Benali' },
  yasmine: { accountId: 'demo-yasmine', displayName: 'Yasmine Taleb' },
} satisfies Record<string, Person>;

const DAY = 86_400_000;

interface Row {
  n: number;
  summary: string;
  status: 'To Do' | 'In Progress' | 'Blocked' | 'Done';
  priority: Priority;
  assignee?: Person;
  reporter?: Person;
  dueInDays?: number;
  statusDaysAgo?: number;
  updatedDaysAgo?: number;
  flagged?: boolean;
  blocks?: number[];
  epic?: number;
  /** Extra labels. 'github' and 'vercel' tie demo work to Outside incidents. */
  labels?: string[];
}

const CATEGORY: Record<Row['status'], StatusCategory> = {
  'To Do': 'todo',
  'In Progress': 'inprogress',
  Blocked: 'inprogress',
  Done: 'done',
};

export function demoRows(me: Person): Row[] {
  const { sami, lina, omar, yasmine } = DEMO_PEOPLE;
  return [
    // The speaker's own work (judge script: "I finished MP-12, MP-15 is blocked on legal, I'll pick up MP-9 today")
    { n: 9, summary: 'Add Arabic voice prompts', status: 'To Do', priority: 'Medium', assignee: me, reporter: sami },
    {
      n: 12,
      summary: 'Fix login redirect on Safari',
      status: 'In Progress',
      priority: 'High',
      assignee: me,
      reporter: sami,
      dueInDays: 1,
      statusDaysAgo: 2,
      labels: ['github'],
    },
    {
      n: 15,
      summary: 'Sign vendor data agreement',
      status: 'In Progress',
      priority: 'Medium',
      assignee: me,
      reporter: sami,
      statusDaysAgo: 1,
    },

    // Risk 1: blocked 6 days, blocks two login-epic issues
    { n: 40, summary: 'Login epic', status: 'In Progress', priority: 'High', reporter: sami, statusDaysAgo: 3 },
    {
      n: 42,
      summary: 'Renew SSO certificate',
      status: 'Blocked',
      priority: 'High',
      assignee: lina,
      reporter: sami,
      statusDaysAgo: 6,
      updatedDaysAgo: 2,
      flagged: true,
      blocks: [45, 51],
      epic: 40,
    },
    {
      n: 45,
      summary: 'Enable SSO for EU tenants',
      status: 'To Do',
      priority: 'Medium',
      assignee: sami,
      reporter: sami,
      epic: 40,
    },
    { n: 51, summary: 'Write SSO admin guide', status: 'To Do', priority: 'Low', assignee: sami, reporter: sami, epic: 40 },

    // Risk 2: Sami holds 6 of 13 open issues
    {
      n: 20,
      summary: 'Billing export to CSV',
      status: 'In Progress',
      priority: 'Medium',
      assignee: sami,
      reporter: omar,
      statusDaysAgo: 2,
    },
    {
      n: 21,
      summary: 'Invoice email template',
      status: 'To Do',
      priority: 'High',
      assignee: sami,
      reporter: omar,
      dueInDays: 10,
    },
    { n: 22, summary: 'Paginate refund API', status: 'To Do', priority: 'Medium', assignee: sami, reporter: omar },
    {
      n: 23,
      summary: 'Billing dashboard filters',
      status: 'In Progress',
      priority: 'Low',
      assignee: sami,
      reporter: omar,
      statusDaysAgo: 2,
    },

    // Risk 3: two days overdue
    {
      n: 38,
      summary: 'Publish new pricing page',
      status: 'In Progress',
      priority: 'Medium',
      assignee: omar,
      reporter: sami,
      dueInDays: -2,
      statusDaysAgo: 4,
      labels: ['vercel'],
    },

    // Quiet background
    { n: 30, summary: 'Onboarding checklist copy', status: 'To Do', priority: 'Low', assignee: yasmine, reporter: sami },
    {
      n: 5,
      summary: 'Set up demo workspace',
      status: 'Done',
      priority: 'Medium',
      assignee: me,
      reporter: sami,
      statusDaysAgo: 5,
    },
  ];
}

export function demoDataset(now: Date, me: Person): { issues: Issue[]; people: Person[] } {
  const rows = demoRows(me);
  const iso = (daysAgo: number) => new Date(now.getTime() - daysAgo * DAY).toISOString();
  const date = (inDays: number) => new Date(now.getTime() + inDays * DAY).toISOString().slice(0, 10);
  const key = (n: number) => `${DEMO_PROJECT}-${n}`;

  const issues: Issue[] = rows.map((r) => ({
    key: key(r.n),
    projectKey: DEMO_PROJECT,
    summary: r.summary,
    status: r.status,
    statusCategory: CATEGORY[r.status],
    statusChangedAt: iso(r.statusDaysAgo ?? 1),
    updatedAt: iso(r.updatedDaysAgo ?? Math.min(r.statusDaysAgo ?? 1, 1)),
    priority: r.priority,
    assignee: r.assignee,
    reporter: r.reporter,
    dueDate: r.dueInDays !== undefined ? date(r.dueInDays) : undefined,
    flagged: r.flagged ?? false,
    blocks: (r.blocks ?? []).map(key),
    blockedBy: [],
    epicKey: r.epic ? key(r.epic) : undefined,
    labels: r.labels ?? [],
  }));
  const byKey = new Map(issues.map((i) => [i.key, i]));
  for (const i of issues) for (const b of i.blocks) byKey.get(b)?.blockedBy.push(i.key);

  return { issues, people: [me, ...Object.values(DEMO_PEOPLE)] };
}
