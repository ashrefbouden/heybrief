// In-memory fakes for unit tests and for the offline demo. No @forge imports.

import type { Clock, ConfluencePort, Deps, IdGen, JiraPort, Store } from '../ports';
import type { Issue, Person, Scope, StatusCategory, Transition } from '../types';

export class FixedClock implements Clock {
  constructor(private t: Date) {}
  now() {
    return new Date(this.t);
  }
  advance(ms: number) {
    this.t = new Date(this.t.getTime() + ms);
  }
}

export class SeqIds implements IdGen {
  private n = 0;
  next() {
    return `p${++this.n}`;
  }
}

export class MemoryStore implements Store {
  data = new Map<string, { v: unknown; exp?: number }>();
  constructor(private clock: Clock) {}
  private alive(k: string) {
    const e = this.data.get(k);
    if (!e) return undefined;
    if (e.exp !== undefined && e.exp <= this.clock.now().getTime()) {
      this.data.delete(k);
      return undefined;
    }
    return e;
  }
  async get<T>(k: string) {
    return structuredClone(this.alive(k)?.v) as T | undefined;
  }
  async set<T>(k: string, v: T, ttl?: number) {
    this.data.set(k, { v: structuredClone(v), exp: ttl ? this.clock.now().getTime() + ttl * 1000 : undefined });
  }
  async delete(k: string) {
    this.data.delete(k);
  }
  async setIfAbsent<T>(k: string, v: T, ttl?: number) {
    if (this.alive(k)) return false;
    await this.set(k, v, ttl);
    return true;
  }
}

export interface Workflow {
  statuses: Array<{ name: string; category: StatusCategory }>;
}

export const DEFAULT_WORKFLOW: Workflow = {
  statuses: [
    { name: 'To Do', category: 'todo' },
    { name: 'In Progress', category: 'inprogress' },
    { name: 'Blocked', category: 'inprogress' },
    { name: 'Done', category: 'done' },
  ],
};

export interface Call {
  method: string;
  args: unknown[];
}

/** Fake Jira with an all-to-all workflow, a permission table and a call log. */
export class FakeJira implements JiraPort {
  issues = new Map<string, Issue>();
  calls: Call[] = [];
  comments: Array<{ key: string; body: string; mentions?: string[] }> = [];
  /** accountId -> keys they may NOT edit. */
  denyEdit = new Map<string, Set<string>>();
  /** accountId -> keys they may NOT browse. */
  denyBrowse = new Map<string, Set<string>>();
  failOn = new Set<string>();
  private seq = 900;

  constructor(
    issues: Issue[],
    private clock: Clock,
    public people: Person[] = [],
    private workflow: Workflow = DEFAULT_WORKFLOW,
  ) {
    for (const i of issues) this.issues.set(i.key, structuredClone(i));
  }

  private log(method: string, ...args: unknown[]) {
    this.calls.push({ method, args });
    if (this.failOn.has(method)) throw new Error(`${method} failed`);
  }
  writes() {
    return this.calls.filter((c) => !['searchOpen', 'getIssue', 'getTransitions', 'canEdit', 'canBrowse'].includes(c.method));
  }
  private must(key: string) {
    const i = this.issues.get(key);
    if (!i) throw new Error(`issue ${key} not found`);
    return i;
  }
  private touch(i: Issue) {
    i.updatedAt = this.clock.now().toISOString();
  }

  async searchOpen(scope: Scope) {
    this.log('searchOpen', scope);
    const all = [...this.issues.values()];
    // Risk Radar needs the neighbourhood (blockers, overload across the team), so "me" returns
    // the whole project the user works in, like the Forge adapter's JQL does.
    const filtered =
      scope.kind === 'project'
        ? all.filter((i) => i.projectKey === scope.projectKey)
        : scope.kind === 'epic'
          ? all.filter((i) => i.epicKey === scope.epicKey || i.key === scope.epicKey)
          : all;
    return structuredClone(filtered.filter((i) => i.statusCategory !== 'done').slice(0, 50));
  }
  async getIssue(key: string) {
    this.log('getIssue', key);
    const i = this.issues.get(key);
    return i ? structuredClone(i) : undefined;
  }
  async getTransitions(key: string): Promise<Transition[]> {
    this.log('getTransitions', key);
    const i = this.must(key);
    return this.workflow.statuses
      .filter((s) => s.name !== i.status)
      .map((s, n) => ({ id: String(11 + n), name: s.name, toStatus: s.name, toCategory: s.category }));
  }
  async transition(key: string, transitionId: string) {
    this.log('transition', key, transitionId);
    const i = this.must(key);
    const t = (await this.getTransitions(key)).find((x) => x.id === transitionId);
    if (!t) throw new Error('invalid transition');
    i.status = t.toStatus;
    i.statusCategory = t.toCategory;
    i.statusChangedAt = this.clock.now().toISOString();
    this.touch(i);
  }
  async addComment(key: string, body: string, mentions?: string[]) {
    this.log('addComment', key, body, mentions);
    this.touch(this.must(key));
    this.comments.push({ key, body, mentions });
  }
  async setFlag(key: string, flagged: boolean) {
    this.log('setFlag', key, flagged);
    const i = this.must(key);
    i.flagged = flagged;
    this.touch(i);
  }
  async linkBlocks(blockerKey: string, blockedKey: string) {
    this.log('linkBlocks', blockerKey, blockedKey);
    const a = this.must(blockerKey);
    const b = this.must(blockedKey);
    if (!a.blocks.includes(blockedKey)) a.blocks.push(blockedKey);
    if (!b.blockedBy.includes(blockerKey)) b.blockedBy.push(blockerKey);
  }
  async unlinkBlocks(blockerKey: string, blockedKey: string) {
    this.log('unlinkBlocks', blockerKey, blockedKey);
    const a = this.issues.get(blockerKey);
    const b = this.issues.get(blockedKey);
    if (a) a.blocks = a.blocks.filter((k) => k !== blockedKey);
    if (b) b.blockedBy = b.blockedBy.filter((k) => k !== blockerKey);
  }
  async deleteIssue(key: string) {
    this.log('deleteIssue', key);
    this.must(key);
    this.issues.delete(key);
    for (const i of this.issues.values()) {
      i.blocks = i.blocks.filter((k) => k !== key);
      i.blockedBy = i.blockedBy.filter((k) => k !== key);
    }
  }
  async assign(key: string, accountId: string | null) {
    this.log('assign', key, accountId);
    const i = this.must(key);
    i.assignee = accountId
      ? (this.people.find((p) => p.accountId === accountId) ?? { accountId, displayName: accountId })
      : undefined;
    this.touch(i);
  }
  async notify(key: string, accountIds: string[], subject: string, body: string) {
    this.log('notify', key, accountIds, subject, body);
  }
  async createIssue(input: { projectKey: string; summary: string; assigneeId?: string; dueDate?: string }) {
    this.log('createIssue', input);
    const key = `${input.projectKey}-${++this.seq}`;
    const now = this.clock.now().toISOString();
    this.issues.set(key, {
      key,
      projectKey: input.projectKey,
      summary: input.summary,
      status: 'To Do',
      statusCategory: 'todo',
      statusChangedAt: now,
      updatedAt: now,
      priority: 'Medium',
      assignee: input.assigneeId ? this.people.find((p) => p.accountId === input.assigneeId) : undefined,
      dueDate: input.dueDate,
      flagged: false,
      blocks: [],
      blockedBy: [],
    });
    return key;
  }
  async canEdit(accountId: string, key: string) {
    this.log('canEdit', accountId, key);
    return !this.denyEdit.get(accountId)?.has(key);
  }
  async canBrowse(accountId: string, keys: string[]) {
    this.log('canBrowse', accountId, keys);
    const deny = this.denyBrowse.get(accountId);
    return new Set(keys.filter((k) => !deny?.has(k)));
  }
}

export class FakeConfluence implements ConfluencePort {
  pages = new Map<string, string[]>();
  async appendStandup(accountId: string, dateIso: string, lines: string[]) {
    const k = `${accountId}:${dateIso}`;
    this.pages.set(k, [...(this.pages.get(k) ?? []), ...lines]);
    return `https://example.atlassian.net/wiki/standup/${dateIso}`;
  }
}

export function makeDeps(issues: Issue[], now: Date, people: Person[] = []) {
  const clock = new FixedClock(now);
  const jira = new FakeJira(issues, clock, people);
  const confluence = new FakeConfluence();
  const store = new MemoryStore(clock);
  const ids = new SeqIds();
  const deps: Deps = { jira, confluence, store, clock, ids };
  return { deps, clock, jira, confluence, store, ids };
}
