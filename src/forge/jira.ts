// Forge adapter for JiraPort, over the Jira Cloud REST API v3.
//
// Two modes:
//   user: Rovo actions, MCP tools, gadget. Calls run asUser(), so Jira enforces permissions.
//   app:  Siri web trigger. There is no user session, so calls run asApp() and EVERY read is
//         filtered through the bulk permission check for the paired accountId. Fail closed.
//
// UNVERIFIED until the M0 deploy (no site to test against from the cloud):
//   - issueLink direction for "Blocks" (see linkBlocks)
//   - "Flagged" custom field lookup by name
//   - search/jql response shape on the demo site

import api, { route } from '@forge/api';
import type { JiraPort } from '../engine/ports';
import { applyDemoHistory, DEMO_LABEL, DEMO_PROPERTY } from '../engine/demo/seed';
import { readJson } from './http';
import { PermissionChecker, type PermissionHttp, type PermissionName } from '../engine/permissions';
import type { Issue, Person, Priority, Scope, StatusCategory, Transition } from '../engine/types';

type Mode = { kind: 'user' } | { kind: 'app'; accountId: string };

const FIELDS = [
  'summary',
  'status',
  'priority',
  'assignee',
  'reporter',
  'duedate',
  'updated',
  'statuscategorychangedate',
  'issuelinks',
  'parent',
  'project',
  'labels',
  'issuetype',
  'created',
  'fixVersions',
];
const MAX_RESULTS = 50;

const CATEGORY: Record<string, StatusCategory> = { new: 'todo', indeterminate: 'inprogress', done: 'done' };

export class ForgeJira implements JiraPort {
  private ids = new Map<string, string>();
  private flaggedField?: string | null;

  constructor(
    private mode: Mode,
    private projectKeys: string[],
  ) {}

  private req(path: ReturnType<typeof route>, init?: RequestInit) {
    const client = this.mode.kind === 'user' ? api.asUser() : api.asApp();
    return client.requestJira(path, init as any);
  }

  private async json<T>(path: ReturnType<typeof route>, init?: RequestInit): Promise<T> {
    const res = await this.req(path, {
      ...init,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    return readJson<T>(res);
  }

  private toIssue(raw: any): Issue {
    const f = raw.fields ?? {};
    this.ids.set(raw.key, raw.id);
    const person = (p: any): Person | undefined => (p ? { accountId: p.accountId, displayName: p.displayName } : undefined);
    const blocks: string[] = [];
    const blockedBy: string[] = [];
    for (const l of f.issuelinks ?? []) {
      if (l.type?.name !== 'Blocks') continue;
      if (l.outwardIssue) blocks.push(l.outwardIssue.key); // this issue "blocks" outwardIssue
      if (l.inwardIssue) blockedBy.push(l.inwardIssue.key); // this issue "is blocked by" inwardIssue
    }
    // Demo issues carry simulated ages so Risk Radar has history on a freshly seeded site.
    // Only honoured on issues labelled heybrief-demo; it can only change risk scores, never permissions.
    const sim = (f.labels ?? []).includes(DEMO_LABEL) ? raw.properties?.[DEMO_PROPERTY] : undefined;
    const times = applyDemoHistory({ statusChangedAt: f.statuscategorychangedate ?? f.updated, updatedAt: f.updated }, sim);
    return {
      key: raw.key,
      projectKey: f.project?.key ?? raw.key.split('-')[0],
      summary: f.summary ?? '',
      status: f.status?.name ?? '',
      statusCategory: CATEGORY[f.status?.statusCategory?.key] ?? 'todo',
      statusChangedAt: times.statusChangedAt,
      updatedAt: times.updatedAt,
      priority: (f.priority?.name as Priority) ?? 'Medium',
      assignee: person(f.assignee),
      reporter: person(f.reporter),
      dueDate: f.duedate ?? undefined,
      flagged: this.flaggedField ? Array.isArray(f[this.flaggedField]) && f[this.flaggedField].length > 0 : false,
      blocks,
      blockedBy,
      epicKey: f.parent?.key,
      issueType: f.issuetype?.name,
      labels: f.labels ?? [],
      fixVersions: Array.isArray(f.fixVersions)
        ? f.fixVersions.map((v: any) => ({ name: String(v?.name ?? ''), releaseDate: v?.releaseDate, released: !!v?.released })).filter((v: { name: string }) => v.name)
        : undefined,
      createdAt: f.created,
    };
  }

  private async flagField(): Promise<string | null> {
    if (this.flaggedField !== undefined) return this.flaggedField;
    const fields = await this.json<Array<{ id: string; name: string }>>(route`/rest/api/3/field`);
    this.flaggedField = fields.find((x) => x.name === 'Flagged')?.id ?? null;
    return this.flaggedField;
  }

  async searchOpen(scope: Scope): Promise<Issue[]> {
    const flag = await this.flagField();
    const projects = this.projectKeys.map((p) => `"${p.replace(/"/g, '')}"`).join(',');
    const base = projects ? `project in (${projects}) AND ` : '';
    const jql =
      scope.kind === 'epic'
        ? `${base}(parent = "${scope.epicKey}" OR key = "${scope.epicKey}") AND statusCategory != Done`
        : scope.kind === 'project'
          ? `project = "${scope.projectKey}" AND statusCategory != Done`
          : `${base}statusCategory != Done`;
    if (
      !/^[A-Z][A-Z0-9_]{0,19}(-\d+)?$/.test(
        scope.kind === 'epic' ? scope.epicKey : scope.kind === 'project' ? scope.projectKey : 'A',
      )
    )
      throw new Error('invalid scope'); // keys go into JQL: validate, never interpolate free text

    let issues: Issue[];
    try {
      issues = await this.runJql(`${jql} ORDER BY updated DESC`, flag);
    } catch (e) {
      // A configured project that was deleted or renamed makes the whole JQL fail with 400.
      // Fall back to everything the user can see rather than going silent.
      if (!(scope.kind === 'me' && base && /Jira 400/.test(String(e)))) throw e;
      issues = await this.runJql(`statusCategory != Done ORDER BY updated DESC`, flag);
    }
    // Configured projects empty for this person (wrong key saved): look at everything they can see.
    if (!issues.length && scope.kind === 'me' && base) issues = await this.runJql(`statusCategory != Done ORDER BY updated DESC`, flag);
    if (this.mode.kind === 'user') return issues;
    const visible = await this.canBrowse(
      this.mode.accountId,
      issues.map((i) => i.key),
    );
    return issues.filter((i) => visible.has(i.key));
  }

  /** Board for the voice page: open issues plus anything finished in the last 7 days. User mode only. */
  async searchBoard(projectKey: string): Promise<Issue[]> {
    if (this.mode.kind !== 'user') throw new Error('board is user-mode only');
    if (!/^[A-Z][A-Z0-9_]{0,19}$/.test(projectKey)) throw new Error('invalid project');
    const flag = await this.flagField();
    return this.runJql(`project = "${projectKey}" AND (statusCategory != Done OR updated >= -7d) ORDER BY key ASC`, flag);
  }

  private async runJql(jql: string, flag: string | null): Promise<Issue[]> {
    const out = await this.json<{ issues: any[] }>(route`/rest/api/3/search/jql`, {
      method: 'POST',
      body: JSON.stringify({
        jql,
        fields: flag ? [...FIELDS, flag] : FIELDS,
        properties: [DEMO_PROPERTY],
        maxResults: MAX_RESULTS,
      }),
    });
    return out.issues.map((r) => this.toIssue(r));
  }

  async getIssue(key: string): Promise<Issue | undefined> {
    const flag = await this.flagField();
    const fields = (flag ? [...FIELDS, flag] : FIELDS).join(',');
    const res = await this.req(route`/rest/api/3/issue/${key}?fields=${fields}&properties=${DEMO_PROPERTY}`, {
      headers: { Accept: 'application/json' },
    });
    if (res.status === 404) return undefined;
    const issue = this.toIssue(await readJson<any>(res));
    if (this.mode.kind === 'app' && !(await this.canBrowse(this.mode.accountId, [key])).has(key)) return undefined;
    return issue;
  }

  async getTransitions(key: string): Promise<Transition[]> {
    const out = await this.json<{ transitions: any[] }>(route`/rest/api/3/issue/${key}/transitions`);
    return out.transitions.map((t) => ({
      id: t.id,
      name: t.name,
      toStatus: t.to?.name ?? t.name,
      toCategory: CATEGORY[t.to?.statusCategory?.key] ?? 'todo',
    }));
  }

  async transition(key: string, transitionId: string) {
    await this.json(route`/rest/api/3/issue/${key}/transitions`, {
      method: 'POST',
      body: JSON.stringify({ transition: { id: transitionId } }),
    });
  }

  async addComment(key: string, body: string, mentions: string[] = []) {
    // ADF: mentions as real mention nodes so Jira notifies those people.
    const content: any[] = [{ type: 'text', text: body }];
    for (const id of mentions) content.push({ type: 'text', text: ' ' }, { type: 'mention', attrs: { id } });
    await this.json(route`/rest/api/3/issue/${key}/comment`, {
      method: 'POST',
      body: JSON.stringify({ body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content }] } }),
    });
  }

  async setFlag(key: string, flagged: boolean) {
    const flag = await this.flagField();
    if (!flag) return; // no Flagged field on this site: the Blocked status and comment carry it
    await this.json(route`/rest/api/3/issue/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ fields: { [flag]: flagged ? [{ value: 'Impediment' }] : null } }),
    });
  }

  async linkBlocks(blockerKey: string, blockedKey: string) {
    // Jira's issueLink naming is famously inverted; for type "Blocks" the issue in inwardIssue
    // ends up as the one that "blocks". VERIFY ON THE DEMO SITE IN M0 and flip if needed.
    await this.json(route`/rest/api/3/issueLink`, {
      method: 'POST',
      body: JSON.stringify({ type: { name: 'Blocks' }, inwardIssue: { key: blockerKey }, outwardIssue: { key: blockedKey } }),
    });
  }

  async unlinkBlocks(blockerKey: string, blockedKey: string) {
    const raw = await this.json<any>(route`/rest/api/3/issue/${blockedKey}?fields=issuelinks`);
    // Same reading as toIssue(): on the blocked issue, the blocker sits in inwardIssue.
    const link = (raw?.fields?.issuelinks ?? []).find(
      (l: any) => l.type?.name === 'Blocks' && (l.inwardIssue?.key === blockerKey || l.outwardIssue?.key === blockerKey),
    );
    if (!link?.id) return;
    const res = await this.req(route`/rest/api/3/issueLink/${String(link.id)}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`unlink failed (${res.status})`);
  }

  async deleteIssue(key: string) {
    const res = await this.req(route`/rest/api/3/issue/${key}`, { method: 'DELETE' });
    if (res.status === 403) throw new Error('you lack permission to delete issues');
    if (!res.ok && res.status !== 404) throw new Error(`delete failed (${res.status})`);
  }

  async assign(key: string, accountId: string | null) {
    await this.json(route`/rest/api/3/issue/${key}/assignee`, { method: 'PUT', body: JSON.stringify({ accountId }) });
  }

  async notify(key: string, accountIds: string[], subject: string, body: string) {
    await this.json(route`/rest/api/3/issue/${key}/notify`, {
      method: 'POST',
      body: JSON.stringify({ subject, textBody: body, to: { users: accountIds.map((accountId) => ({ accountId })) } }),
    });
  }

  async createIssue(input: { projectKey: string; summary: string; assigneeId?: string; dueDate?: string }) {
    const fields: Record<string, unknown> = {
      project: { key: input.projectKey },
      summary: input.summary,
      issuetype: { name: 'Task' },
    };
    if (input.assigneeId) fields.assignee = { accountId: input.assigneeId };
    if (input.dueDate) fields.duedate = input.dueDate;
    const out = await this.json<{ key: string; id: string }>(route`/rest/api/3/issue`, {
      method: 'POST',
      body: JSON.stringify({ fields }),
    });
    this.ids.set(out.key, out.id);
    return out.key;
  }

  private permHttp: PermissionHttp = {
    idOf: async (key) => {
      if (!this.ids.has(key)) {
        // asApp lookup only resolves the id; visibility is decided by the permission check.
        const res = await api.asApp().requestJira(route`/rest/api/3/issue/${key}?fields=summary`);
        if (!res.ok) return undefined;
        const j: any = await readJson<any>(res);
        this.ids.set(key, j.id);
      }
      return Number(this.ids.get(key));
    },
    bulk: async (accountId, issueIds, permissions) => {
      const res = await api.asApp().requestJira(route`/rest/api/3/permissions/check`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, projectPermissions: [{ permissions, issues: issueIds }] }),
      });
      if (!res.ok) return { ok: false, status: res.status };
      const out: any = (await readJson<any>(res)) ?? {};
      const granted = new Map<PermissionName, Set<number>>();
      for (const p of out.projectPermissions ?? []) granted.set(p.permission, new Set<number>((p.issues ?? []).map(Number)));
      return { ok: true, granted };
    },
    userHas: async (accountId, permissions, target) => {
      const perms = permissions.join(',');
      const path =
        'issueKey' in target
          ? route`/rest/api/3/user/permission/search?accountId=${accountId}&permissions=${perms}&issueKey=${target.issueKey}&maxResults=1`
          : route`/rest/api/3/user/permission/search?accountId=${accountId}&permissions=${perms}&projectKey=${target.projectKey}&maxResults=1`;
      const res = await api.asApp().requestJira(path, { headers: { Accept: 'application/json' } });
      if (!res.ok) return false;
      const users: any[] = (await readJson<any[]>(res)) ?? [];
      return users.some((u) => u.accountId === accountId);
    },
  };
  private perms = new PermissionChecker(this.permHttp);

  async canEdit(accountId: string, key: string) {
    return (await this.perms.allowed(accountId, [key], ['EDIT_ISSUES', 'TRANSITION_ISSUES'], 'write')).has(key);
  }

  async canBrowse(accountId: string, keys: string[]) {
    return this.perms.allowed(accountId, keys, ['BROWSE_PROJECTS'], 'read');
  }
}
