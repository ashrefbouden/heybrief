// Forge implementation of the demo seeder port, plus the admin check for settings.
// UNVERIFIED until M0: issue type names ("Task", "Epic") and the priority field on the demo project.

import api, { route } from '@forge/api';
import { DEMO_PROPERTY, seedDemo, type SeedPort } from '../engine/demo/seed';
import type { Person } from '../engine/types';
import { readJson, type HttpResponse } from '../forge/http';
import { ForgeJira } from '../forge/jira';
import { loadSettings, saveSettings } from './wiring';

const json = <T>(res: HttpResponse) => readJson<T>(res);

const H = { Accept: 'application/json', 'Content-Type': 'application/json' };

export async function isJiraAdmin(_accountId: string): Promise<boolean> {
  // Runs as the signed-in user: Jira answers for them, not for the app.
  const res = await api.asUser().requestJira(route`/rest/api/3/mypermissions?permissions=ADMINISTER`, { headers: H });
  if (!res.ok) return false;
  const j: any = await readJson<any>(res);
  return j?.permissions?.ADMINISTER?.havePermission === true;
}

export function forgeSeedPort(projectKey: string): SeedPort {
  const jira = new ForgeJira({ kind: 'user' }, [projectKey]);
  const user = () => api.asUser();
  return {
    async findDemoIssues(pk) {
      const out = await json<{ issues: Array<{ key: string; properties?: Record<string, unknown> }> }>(
        await user().requestJira(route`/rest/api/3/search/jql`, {
          method: 'POST',
          headers: H,
          body: JSON.stringify({
            jql: `project = "${pk}" AND labels = "heybrief-demo"`,
            fields: ['summary'],
            properties: [DEMO_PROPERTY],
            maxResults: 50,
          }),
        }),
      );
      return (out?.issues ?? []).map((i) => ({ key: i.key, complete: i.properties?.[DEMO_PROPERTY] != null }));
    },
    async deleteIssue(key) {
      await json(await user().requestJira(route`/rest/api/3/issue/${key}?deleteSubtasks=true`, { method: 'DELETE', headers: H }));
    },
    async assignableUsers(pk) {
      const users = await json<any[]>(
        await user().requestJira(route`/rest/api/3/user/assignable/search?project=${pk}&maxResults=50`, { headers: H }),
      );
      return users
        .filter((u) => u.accountType === 'atlassian' && u.active !== false)
        .map((u): Person => ({ accountId: u.accountId, displayName: u.displayName }));
    },
    async createIssue(i) {
      const fields: Record<string, unknown> = {
        project: { key: i.projectKey },
        summary: i.summary,
        issuetype: { name: i.issueType },
        labels: i.labels,
        priority: { name: i.priority },
      };
      if (i.assigneeId) fields.assignee = { accountId: i.assigneeId };
      if (i.dueDate) fields.duedate = i.dueDate;
      if (i.parentKey) fields.parent = { key: i.parentKey };
      const post = (f: Record<string, unknown>) =>
        user().requestJira(route`/rest/api/3/issue`, { method: 'POST', headers: H, body: JSON.stringify({ fields: f }) });
      // Team-managed projects often hide priority or due date from the create screen: retry leaner,
      // then set the due date afterwards (the overdue risk needs it) if the edit screen allows it.
      let res = await post(fields);
      if (res.status === 400) {
        const { priority: _p, ...noPriority } = fields;
        res = await post(noPriority);
        if (res.status === 400 && fields.duedate) {
          const { duedate: _d, ...lean } = noPriority;
          res = await post(lean);
          const key = (await json<{ key: string }>(res)).key;
          await user()
            .requestJira(route`/rest/api/3/issue/${key}`, {
              method: 'PUT',
              headers: H,
              body: JSON.stringify({ fields: { duedate: fields.duedate } }),
            })
            .catch(() => undefined);
          return key;
        }
      }
      return (await json<{ key: string }>(res)).key;
    },
    async transitionTo(key, status) {
      const ts = await jira.getTransitions(key);
      const t = ts.find((x) => x.toStatus.toLowerCase() === status.toLowerCase());
      if (!t) return false;
      await jira.transition(key, t.id);
      return true;
    },
    setFlag: (key, flagged) => jira.setFlag(key, flagged),
    linkBlocks: (a, b) => jira.linkBlocks(a, b),
    async setProperty(key, property, value) {
      await json(
        await user().requestJira(route`/rest/api/3/issue/${key}/properties/${property}`, {
          method: 'PUT',
          headers: H,
          body: JSON.stringify(value),
        }),
      );
    },
  };
}

/** Demo helper for the voice page: a real unassigned Highest-priority outage that Heads-up should catch. */
export async function createDemoIncident(): Promise<string> {
  const settings = await loadSettings();
  const pk = settings.projectKeys[0];
  if (!pk) throw new Error('Load demo data first.');
  return forgeSeedPort(pk).createIssue({
    projectKey: pk,
    summary: 'Checkout API down in production',
    issueType: 'Task',
    priority: 'Highest',
    labels: ['heybrief-demo', 'incident'],
  } as Parameters<SeedPort['createIssue']>[0]);
}

export async function seedDemoProject(accountId: string, projectKey: string) {
  const settings = await loadSettings();
  const pk = projectKey || settings.projectKeys[0];
  if (!pk || !/^[A-Z][A-Z0-9_]{0,19}$/.test(pk)) throw new Error('Enter the key of an empty test project, for example DEMO.');
  const me = await json<any>(await api.asUser().requestJira(route`/rest/api/3/myself`, { headers: H }));
  const result = await seedDemo(forgeSeedPort(pk), {
    projectKey: pk,
    me: { accountId, displayName: me.displayName },
    now: new Date(),
  });
  // The demo project goes first: the voice page's Team pulse shows the first project.
  await saveSettings({ projectKeys: [pk, ...settings.projectKeys.filter((k) => k !== pk)] });
  return result;
}
