// Confirm-before-write gate (WorldGuard-style human approval).
// - One pending action per user; a new proposal replaces the old one.
// - Expires after 2 minutes (checked against the clock, not only the store TTL).
// - Single use: claimed with an atomic setIfAbsent, so two racing "yes" replies run it once.
// - Bound to the accountId that created it.
// - Anything other than a clear yes cancels it.

import { executeOps } from './execute';
import { viewReceipt } from './receipt';
import type { Deps } from './ports';
import { T } from './speak';
import { startsWithWord, words } from './words';
import type { Lang, OpResult, Op, PendingAction, PendingKind, Receipt } from './types';

export const CONFIRM_TTL_SECONDS = 120;
/** Confirmed write batches per user per hour. Stops a misbehaving agent loop from spamming Jira. */
export const MAX_CONFIRMED_PER_HOUR = 30;
const RECEIPT_TTL_SECONDS = 7 * 24 * 3600;
const MAX_RECEIPTS = 20;

const pendingKey = (accountId: string) => `pending:${accountId}`;
const claimKey = (id: string) => `claimed:${id}`;
const receiptsKey = (accountId: string) => `receipts:${accountId}`;

export type Reply = 'yes' | 'no' | 'other';

const YES = startsWithWord([
  'yes',
  'yeah',
  'yep',
  'yup',
  'sure',
  'ok',
  'okay',
  'do it',
  'go ahead',
  'confirm(?:ed)?',
  'save(?: it)?',
  'please do',
  'oui',
  'ouais',
  'vas-y',
  "d'accord",
  'd’accord',
  'confirme[rz]?',
  'enregistre',
  'نعم',
  'أجل',
  'ايوه',
  'إيه',
  'موافق',
  'تمام',
  'أكد',
  'احفظ',
]);
const NO = words([
  'no',
  'nope',
  'nah',
  'cancel',
  'stop',
  "don't",
  'do not',
  'wait',
  'not yet',
  'non',
  'annule[rz]?',
  'pas encore',
  'attends',
  'لا',
  'إلغاء',
  'ألغ[يِ]?',
  'انتظر',
  'توقف',
]);

export function classifyReply(text: string): Reply {
  const s = text
    .trim()
    .toLowerCase()
    .replace(/^(hey siri|siri|um+|uh+|so|well|alors|euh|يعني)[,،\s]+/iu, '')
    .replace(/[.!?،؟]+$/g, '');
  if (!s) return 'other';
  const no = NO.test(s);
  const yes = YES.test(s);
  if (yes && !no) return 'yes';
  if (no) return 'no'; // "yes... no wait" is a no
  return 'other';
}

export async function propose(
  deps: Pick<Deps, 'store' | 'clock' | 'ids'>,
  p: { accountId: string; kind: PendingKind; ops: Op[]; heard: string; readback: string },
): Promise<PendingAction> {
  const pending: PendingAction = {
    id: deps.ids.next(),
    accountId: p.accountId,
    kind: p.kind,
    ops: p.ops,
    heard: p.heard.slice(0, 1000),
    readback: p.readback,
    expiresAt: new Date(deps.clock.now().getTime() + CONFIRM_TTL_SECONDS * 1000).toISOString(),
  };
  await deps.store.set(pendingKey(p.accountId), pending, CONFIRM_TTL_SECONDS);
  return pending;
}

export async function getPending(deps: Pick<Deps, 'store' | 'clock'>, accountId: string): Promise<PendingAction | undefined> {
  const p = await deps.store.get<PendingAction>(pendingKey(accountId));
  if (!p) return undefined;
  if (new Date(p.expiresAt).getTime() <= deps.clock.now().getTime()) return undefined;
  return p;
}

export type ConfirmOutcome =
  | { status: 'saved' | 'partial'; speech: string; receipt: Receipt }
  | { status: 'cancelled' | 'expired' | 'nothing' | 'mismatch'; speech: string };

/**
 * Resolve the user's pending action with their reply.
 * pendingId is required from Rovo/MCP (the agent must echo the id it was given) and optional for Siri,
 * where the follow-up turn is the same device session.
 */
export async function resolvePending(
  deps: Deps,
  input: { accountId: string; reply: string; lang: Lang; pendingId?: string },
): Promise<ConfirmOutcome> {
  const t = T[input.lang];
  const raw = await deps.store.get<PendingAction>(pendingKey(input.accountId));
  if (!raw) return { status: 'nothing', speech: t.nothingPending };
  if (raw.accountId !== input.accountId) return { status: 'mismatch', speech: t.nothingPending };
  if (input.pendingId && input.pendingId !== raw.id) return { status: 'mismatch', speech: t.expired };
  if (new Date(raw.expiresAt).getTime() <= deps.clock.now().getTime()) {
    await deps.store.delete(pendingKey(input.accountId));
    return { status: 'expired', speech: t.expired };
  }

  const reply = classifyReply(input.reply);
  if (reply !== 'yes') {
    await deps.store.delete(pendingKey(input.accountId));
    return { status: 'cancelled', speech: t.cancelled };
  }

  // Write budget: checked before claiming so a refused yes can be retried next hour.
  const hour = Math.floor(deps.clock.now().getTime() / 3_600_000);
  const budgetKey = `writes:${input.accountId}:${hour}`;
  const used = (await deps.store.get<number>(budgetKey)) ?? 0;
  if (used >= MAX_CONFIRMED_PER_HOUR) {
    await deps.store.delete(pendingKey(input.accountId));
    return { status: 'cancelled', speech: t.tooManyWrites };
  }

  // Claim before executing: a duplicate "yes" (Siri retry, double tap) cannot run the writes twice.
  const claimed = await deps.store.setIfAbsent(claimKey(raw.id), deps.clock.now().toISOString(), CONFIRM_TTL_SECONDS * 5);
  if (!claimed) return { status: 'expired', speech: t.expired };
  await deps.store.delete(pendingKey(input.accountId));
  await deps.store.set(budgetKey, used + 1, 7200);

  const results = await executeOps(raw.ops, deps, input.accountId);
  const receipt: Receipt = {
    id: raw.id,
    accountId: input.accountId,
    at: deps.clock.now().toISOString(),
    kind: raw.kind,
    heard: raw.heard,
    results,
  };
  await saveReceipt(deps, receipt);

  const ok = results.filter((r) => r.ok).length;
  const failed = results.length - ok;
  const changed = countChangedIssues(results);
  const created = results.find((r) => r.createdKey)?.createdKey;
  if (failed === 0) {
    const speech = created ? `${t.saved(changed || 1)} ${created}.` : t.saved(changed || ok);
    return { status: 'saved', speech, receipt };
  }
  return { status: 'partial', speech: t.savedPartial(ok, failed), receipt };
}

function countChangedIssues(results: OpResult[]): number {
  const keys = new Set<string>();
  for (const r of results) if (r.ok && 'issueKey' in r.op && r.op.type !== 'notify') keys.add(r.op.issueKey);
  return keys.size;
}

async function saveReceipt(deps: Pick<Deps, 'store'>, receipt: Receipt): Promise<void> {
  const list = (await deps.store.get<Receipt[]>(receiptsKey(receipt.accountId))) ?? [];
  list.unshift(receipt);
  await deps.store.set(receiptsKey(receipt.accountId), list.slice(0, MAX_RECEIPTS), RECEIPT_TTL_SECONDS);
}

export async function listReceipts(deps: Pick<Deps, 'store'>, accountId: string): Promise<Receipt[]> {
  return (await deps.store.get<Receipt[]>(receiptsKey(accountId))) ?? [];
}

/** Undo a receipt from the desk gadget. Only reversible ops (transition, flag, assign) are undone. */
export async function undoReceipt(deps: Deps, accountId: string, receiptId: string): Promise<OpResult[]> {
  const list = await listReceipts(deps, accountId);
  const r = list.find((x) => x.id === receiptId);
  if (!r) throw new Error('receipt not found');
  const claimed = await deps.store.setIfAbsent(`undone:${receiptId}`, true, RECEIPT_TTL_SECONDS);
  if (!claimed) throw new Error('already undone');
  const undoOps = r.results
    .filter((x) => x.ok && x.undo)
    .map((x) => x.undo!)
    .reverse();
  return executeOps(undoOps, deps, accountId);
}

/** Receipts with an undone flag, for the gadget. */
export async function listReceiptViews(deps: Pick<Deps, 'store'>, accountId: string) {
  const list = await listReceipts(deps, accountId);
  return Promise.all(list.map(async (r) => viewReceipt(r, (await deps.store.get(`undone:${r.id}`)) !== undefined)));
}
