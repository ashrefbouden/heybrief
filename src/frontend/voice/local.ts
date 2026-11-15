// The prototype backend: the real HeyBrief engine running in the browser over a simulated Jira
// loaded with the demo story. Same use cases, same confirm gate, same undo as the Forge app.

import { listReceiptViews, undoReceipt } from '../../engine/confirm';
import { demoDataset } from '../../engine/demo/data';
import { alertBanner, HeyBrief } from '../../engine/heybrief';
import type { Clock, Deps } from '../../engine/ports';
import { FakeConfluence, FakeJira, MemoryStore } from '../../engine/testing/fakes';
import type { Issue } from '../../engine/types';
import { VENDOR_IDS, type VendorIncident } from '../../engine/outside/incidents';
import type { Backend, BoardIssue, Turn } from './types';

const ME = { accountId: 'me-1', displayName: 'You' };

const realClock: Clock = { now: () => new Date() };

export function localBackend(): Backend {
  let jira: FakeJira;
  let deps: Deps;
  let hb: HeyBrief;
  let n = 0;
  let outages: VendorIncident[] = [];

  function boot() {
    const { issues, people } = demoDataset(new Date(), ME);
    jira = new FakeJira(issues, realClock, [ME, ...people]);
    deps = {
      jira,
      confluence: new FakeConfluence(),
      store: new MemoryStore(realClock),
      clock: realClock,
      ids: { next: () => `local-${++n}` },
      status: { unresolved: async () => outages },
    };
    outages = [];
    hb = new HeyBrief(deps, { projectKeys: ['MP'], outside: { enabled: true, vendors: VENDOR_IDS } });
  }
  boot();

  const turn = (a: Awaited<ReturnType<HeyBrief['safely']>>): Turn => ({
    speech: a.speech,
    lang: a.lang,
    pendingId: a.pendingId,
    changes: a.pendingId ? a.changes : undefined,
    expectReply: a.expectReply,
    failed: a.failed,
    alert: alertBanner(a.data),
  });

  return {
    label: 'Simulated Jira · demo project MP',
    async ask(text, { lang, minutes }) {
      return turn(await hb.safely(lang ?? 'en', () => hb.route(ME.accountId, text, { lang, etaMinutes: minutes })));
    },
    async decide(pendingId, yes, lang) {
      return turn(await hb.safely(lang ?? 'en', () => hb.confirm(ME.accountId, yes ? 'yes' : 'no', pendingId, lang)));
    },
    async board(): Promise<BoardIssue[]> {
      const names = new Map(jira.people.map((p) => [p.accountId, p.displayName]));
      return [...jira.issues.values()]
        .filter((i) => i.key !== 'MP-40') // the epic is context, not a card
        .sort((a, b) => Number(a.key.split('-')[1]) - Number(b.key.split('-')[1]))
        .map((i) => ({
          key: i.key,
          summary: i.summary,
          status: i.status,
          statusCategory: i.statusCategory,
          assignee: i.assignee ? (names.get(i.assignee.accountId) ?? i.assignee.displayName) : undefined,
          priority: i.priority,
          flagged: i.flagged,
          dueDate: i.dueDate,
          blockedBy: i.blockedBy,
          blocks: i.blocks,
          mine: i.assignee?.accountId === ME.accountId,
        }));
    },
    receipts: (lang) => listReceiptViews(deps, ME.accountId, lang),
    async undo(id) {
      const r = await undoReceipt(deps, ME.accountId, id);
      return { ok: r.length > 0 && r.every((x) => x.ok) };
    },
    async reset() {
      boot();
    },
    async alerts(lang) {
      try {
        return turn(await hb.alerts(ME.accountId, { lang }));
      } catch {
        return { speech: '', lang, expectReply: false };
      }
    },
    async simulateOutage() {
      outages = [
        {
          vendor: 'github',
          id: `sim-${Date.now()}`,
          name: 'Degraded performance for GitHub Actions',
          impact: 'major',
          status: 'investigating',
          components: ['Actions'],
          startedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
        },
      ];
      await deps.store.delete(`outside:${[...VENDOR_IDS].sort().join(',')}`);
    },
    async simulateIncident() {
      const now = new Date().toISOString();
      const n = 1 + Math.max(0, ...[...jira.issues.keys()].map((k) => Number(k.split('-')[1]) || 0));
      const incident: Issue = {
        key: `MP-${n}`,
        projectKey: 'MP',
        summary: 'Checkout API down in production',
        status: 'To Do',
        statusCategory: 'todo',
        statusChangedAt: now,
        updatedAt: now,
        createdAt: now,
        priority: 'Highest',
        issueType: 'Incident',
        // Ships in 3 days, so the response plan can name the release at risk.
        fixVersions: [{ name: '2.4', releaseDate: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10) }],
        reporter: jira.people.find((p) => p.accountId !== ME.accountId),
        flagged: false,
        blocks: [],
        blockedBy: [],
      };
      jira.issues.set(incident.key, incident);
    },
  };
}
