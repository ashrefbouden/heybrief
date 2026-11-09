// Forge implementation of the demo seeder port, plus the admin check for settings.
// UNVERIFIED until M0: issue type names ("Task", "Epic") and the priority field on the demo project.

import api, { route } from '@forge/api';
import { seedDemo, type SeedPort } from '../engine/demo/seed';
import type { Person } from '../engine/types';
import { ForgeJira } from '../forge/jira';
import { loadSettings, saveSettings } from './wiring';

async function json<T>(res: Awaited<ReturnType<ReturnType<typeof api.asUser>['requestJira']>>): Promise<T> {
  if (!res.ok) throw new Error(`Jira ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const H = { Accept: 'application/json', 'Content-Type': 'application/json' };

export async function isJiraAdmin(_accountId: string): Promise<boolean> {
  // Runs as the signed-in user: Jira answers for them, not for the app.
  const res = await api.asUser().requestJira(route`/rest/api/3/mypermissions?permissions=ADMINISTER`, { headers: H });
  if (!res.ok) return false;
  const j: any = await res.json();
  return j?.permissions?.ADMINISTER?.havePermission === true;
}

export function forgeSeedPort(projectKey: string): SeedPort {
  const jira = new ForgeJira({ kind: 'user' }, [projectKey]);
  const user = () => api.asUser();
  return {
    async findDemoIssues(pk) {
      const out = await json<{ issues: Array<{ key: string }> }>(
        await user().requestJira(route`/rest/api/3/search/jql`, {
          method: 'POST',
          headers: H,
          body: JSON.stringify({ jql: `project = "${pk}" AND labels = "heybrief-demo"`, fields: ['summary'], maxResults: 50 }),
        }),
      );
      return out.issues.map((i) => i.key);
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
      let res = await post(fields);
      if (res.status === 400) {
        // Team-managed projects often hide priority or due date from the create screen: retry lean.
        const lean = { ...fields };
        delete lean.priority;
        res = await post(lean);
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

export async function seedDemoProject(accountId: string, projectKey: string) {
  const settings = await loadSettings();
  const pk = projectKey || settings.projectKeys[0];
  const me = await json<any>(await api.asUser().requestJira(route`/rest/api/3/myself`, { headers: H }));
  const result = await seedDemo(forgeSeedPort(pk), {
    projectKey: pk,
    me: { accountId, displayName: me.displayName },
    now: new Date(),
  });
  if (!settings.projectKeys.includes(pk)) await saveSettings({ projectKeys: [...settings.projectKeys, pk] });
  return result;
}
