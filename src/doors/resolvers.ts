// Resolvers for the UI Kit surfaces: the drive-receipt gadget and the settings/pairing page.

import Resolver from '@forge/resolver';
import { webTrigger } from '@forge/api';
import { listReceiptViews, undoReceipt } from '../engine/confirm';
import { issueToken, revokeToken } from '../engine/siri/auth';
import { forgeStore } from '../forge/store';
import { engineFor, loadSettings, saveSettings } from './wiring';
import { isJiraAdmin, seedDemoProject } from './seed';

const resolver = new Resolver();
const clock = { now: () => new Date() };

function me(context: Record<string, any>): string {
  const id = context?.accountId;
  if (typeof id !== 'string' || !id) throw new Error('not signed in');
  return id;
}

const str = (v: unknown, max = 100) => (typeof v === 'string' ? v.slice(0, max) : '');

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

// ---- Settings / pairing ----
/** Pair a phone: returns the plain token once, plus the web trigger URL for the Shortcut. */
resolver.define('pairPhone', async ({ context }) => {
  const token = await issueToken(forgeStore, clock, me(context));
  const url = await webTrigger.getUrl('siri');
  return { token, url };
});

resolver.define('unpairPhone', async ({ context }) => {
  await revokeToken(forgeStore, me(context));
  return { ok: true };
});

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
