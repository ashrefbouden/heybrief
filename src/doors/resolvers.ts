// Resolvers for the UI Kit surfaces: the drive-receipt gadget and the settings/pairing page.

import Resolver from '@forge/resolver';
import { webTrigger } from '@forge/api';
import { listReceipts, undoReceipt } from '../engine/confirm';
import { issueToken, revokeToken } from '../engine/siri/auth';
import { forgeStore } from '../forge/store';
import { engineFor, loadSettings, saveSettings } from './wiring';

const resolver = new Resolver();
const clock = { now: () => new Date() };

function me(context: Record<string, any>): string {
  const id = context?.accountId;
  if (typeof id !== 'string' || !id) throw new Error('not signed in');
  return id;
}

resolver.define('getReceipts', async ({ context }) => listReceipts({ store: forgeStore }, me(context)));

resolver.define('undo', async ({ payload, context }) => {
  const { deps } = await engineFor({ kind: 'user' });
  return undoReceipt(deps, me(context), String((payload as any)?.receiptId ?? ''));
});

resolver.define('getRisks', async ({ context }) => {
  const { hb } = await engineFor({ kind: 'user' });
  const a = await hb.radar(me(context), { kind: 'me', accountId: me(context) });
  return a.data;
});

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

resolver.define('getSettings', async () => loadSettings());

// TODO(Nov 16): restrict to Jira admins with the permissions API before shipping.
resolver.define('saveSettings', async ({ payload }) => saveSettings(payload as any));

export const handler = resolver.getDefinitions();
