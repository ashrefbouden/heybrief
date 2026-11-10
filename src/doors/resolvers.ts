// Resolvers for the UI surfaces: the HeyBrief voice page, the drive-receipt gadget and the settings page.
// Everything runs as the signed-in user, so Jira enforces their permissions on every read and write.

import Resolver from '@forge/resolver';
import { listReceiptViews, undoReceipt } from '../engine/confirm';
import type { Lang } from '../engine/types';
import type { ForgeJira } from '../forge/jira';
import { forgeStore } from '../forge/store';
import { engineFor, loadSettings, saveSettings } from './wiring';
import { isJiraAdmin, seedDemoProject } from './seed';

const resolver = new Resolver();

function me(context: Record<string, any>): string {
  const id = context?.accountId;
  if (typeof id !== 'string' || !id) throw new Error('not signed in');
  return id;
}

const str = (v: unknown, max = 100) => (typeof v === 'string' ? v.slice(0, max) : '');

// ---- Voice page ----
const LANGS = new Set(['en', 'fr', 'ar']);
const langOf = (v: unknown): Lang | undefined => (typeof v === 'string' && LANGS.has(v) ? (v as Lang) : undefined);
const turn = (a: { speech: string; lang: Lang; pendingId?: string; expectReply: boolean; failed?: string }) => ({
  speech: a.speech,
  lang: a.lang,
  pendingId: a.pendingId,
  expectReply: a.expectReply,
  failed: a.failed,
});

/** One spoken or typed sentence: brief, risks, why, a talk-back update, or yes/no to a pending change. */
resolver.define('ask', async ({ payload, context }) => {
  const p = payload as any;
  const lang = langOf(p?.lang);
  const minutes = Number(p?.minutes);
  const { hb } = await engineFor({ kind: 'user' });
  return turn(
    await hb.safely(lang ?? 'en', () =>
      hb.route(me(context), str(p?.text, 500), {
        lang,
        etaMinutes: Number.isFinite(minutes) && minutes > 0 && minutes <= 120 ? minutes : undefined,
      }),
    ),
  );
});

/** Confirm or cancel the pending change shown on screen. The pendingId must match, so a stale card cannot confirm a newer proposal. */
resolver.define('decide', async ({ payload, context }) => {
  const p = payload as any;
  const lang = langOf(p?.lang);
  const { hb } = await engineFor({ kind: 'user' });
  return turn(
    await hb.safely(lang ?? 'en', () => hb.confirm(me(context), p?.yes === true ? 'yes' : 'no', str(p?.pendingId), lang)),
  );
});

resolver.define('board', async ({ context }) => {
  me(context);
  const { deps, settings } = await engineFor({ kind: 'user' });
  const issues = await (deps.jira as ForgeJira).searchBoard(settings.projectKeys[0] ?? 'MP');
  return issues.map((i) => ({
    key: i.key,
    summary: i.summary,
    status: i.status,
    statusCategory: i.statusCategory,
    assignee: i.assignee?.displayName,
    priority: i.priority,
    flagged: i.flagged,
    dueDate: i.dueDate,
    blockedBy: i.blockedBy,
    blocks: i.blocks,
  }));
});

// ---- Drive receipt gadget ----
resolver.define('getReceipts', async ({ context }) => listReceiptViews({ store: forgeStore }, me(context)));

resolver.define('undo', async ({ payload, context }) => {
  const { deps } = await engineFor({ kind: 'user' });
  const results = await undoReceipt(deps, me(context), str((payload as any)?.receiptId));
  return { ok: results.every((r) => r.ok), failed: results.filter((r) => !r.ok).length };
});

resolver.define('getRisks', async ({ context }) => {
  const { hb } = await engineFor({ kind: 'user' });
  return hb.scanRisks(me(context), { kind: 'me', accountId: me(context) });
});

/** Step 1 of 2: propose the fix for risk n. The UI shows the read-back and a Confirm button. */
resolver.define('proposeRiskFix', async ({ payload, context }) => {
  const { hb } = await engineFor({ kind: 'user' });
  const n = Math.min(3, Math.max(1, Number((payload as any)?.rank) || 1));
  const a = await hb.proposeRiskFix(me(context), n);
  return { readback: a.speech, pendingId: a.pendingId };
});

/** Step 2 of 2: the user clicked Confirm (or Cancel). */
resolver.define('resolvePending', async ({ payload, context }) => {
  const { hb } = await engineFor({ kind: 'user' });
  const p = payload as any;
  const reply = p?.confirm === true ? 'yes' : 'no';
  const a = await hb.safely('en', () => hb.confirm(me(context), reply, str(p?.pendingId)));
  return { speech: a.speech };
});

// ---- Settings ----
resolver.define('getSettings', async ({ context }) => ({ ...(await loadSettings()), isAdmin: await isJiraAdmin(me(context)) }));

resolver.define('saveSettings', async ({ payload, context }) => {
  if (!(await isJiraAdmin(me(context)))) throw new Error('Only Jira admins can change HeyBrief settings.');
  return saveSettings(payload as any);
});

/** One-click demo data. Admin only; refuses if demo issues already exist. */
resolver.define('loadDemoData', async ({ payload, context }) => {
  if (!(await isJiraAdmin(me(context)))) throw new Error('Only Jira admins can load demo data.');
  return seedDemoProject(me(context), str((payload as any)?.projectKey, 20).toUpperCase());
});

export const handler = resolver.getDefinitions();
