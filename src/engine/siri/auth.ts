// Siri pairing and request guard.
// Siri can't do Atlassian OAuth, so the user pairs their phone once: the settings page
// shows a random token, the iOS Shortcut sends it as a Bearer header.
// - Only the SHA-256 hash is stored, mapped to the accountId.
// - Rotating issues a new token and revokes the old one.
// - 20 requests a minute per token (fixed window).

import { createHash, randomBytes } from 'node:crypto';
import type { Clock, Store } from '../ports';

export const RATE_LIMIT_PER_MINUTE = 20;
const TOKEN_BYTES = 32;

export interface Pairing {
  accountId: string;
  createdAt: string;
}

export const hashToken = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

const pairKey = (hash: string) => `pair:${hash}`;
const userKey = (accountId: string) => `pairuser:${accountId}`;

/** Create (or rotate) the user's token. Returns the plain token once; it is never stored. */
export async function issueToken(store: Store, clock: Clock, accountId: string, random = randomBytes): Promise<string> {
  const oldHash = await store.get<string>(userKey(accountId));
  if (oldHash) await store.delete(pairKey(oldHash));
  const token = 'hb_' + random(TOKEN_BYTES).toString('base64url');
  const hash = hashToken(token);
  await store.set<Pairing>(pairKey(hash), { accountId, createdAt: clock.now().toISOString() });
  await store.set(userKey(accountId), hash);
  return token;
}

export async function revokeToken(store: Store, accountId: string): Promise<void> {
  const hash = await store.get<string>(userKey(accountId));
  if (hash) await store.delete(pairKey(hash));
  await store.delete(userKey(accountId));
}

export type AuthResult = { ok: true; accountId: string; tokenHash: string } | { ok: false; status: 401 | 429; error: string };

function bearer(headers: Record<string, string[] | undefined>): string | undefined {
  const raw = Object.entries(headers).find(([k]) => k.toLowerCase() === 'authorization')?.[1]?.[0];
  const m = raw?.match(/^Bearer\s+(hb_[A-Za-z0-9_-]{20,100})$/);
  return m?.[1];
}

/**
 * Authenticate a web trigger request and apply the rate limit.
 * The counter is a read-then-write on KVS, so a burst can overshoot by a few requests;
 * acceptable for a per-user voice endpoint.
 */
export async function authenticate(
  store: Store,
  clock: Clock,
  headers: Record<string, string[] | undefined>,
): Promise<AuthResult> {
  const token = bearer(headers);
  if (!token) return { ok: false, status: 401, error: 'missing or malformed token' };
  const tokenHash = hashToken(token);
  const pairing = await store.get<Pairing>(pairKey(tokenHash));
  if (!pairing) return { ok: false, status: 401, error: 'unknown or rotated token' };

  const minute = Math.floor(clock.now().getTime() / 60_000);
  const rlKey = `rl:${tokenHash.slice(0, 32)}:${minute}`;
  const count = (await store.get<number>(rlKey)) ?? 0;
  if (count >= RATE_LIMIT_PER_MINUTE) return { ok: false, status: 429, error: 'rate limited' };
  await store.set(rlKey, count + 1, 120);

  return { ok: true, accountId: pairing.accountId, tokenHash };
}

export interface SiriRequest {
  text: string;
  lang?: string;
  etaMinutes?: number;
}

/** Validate the JSON body. Returns undefined for anything malformed. */
export function parseSiriBody(body: string | undefined): SiriRequest | undefined {
  if (!body || body.length > 4000) return undefined;
  let j: unknown;
  try {
    j = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (!j || typeof j !== 'object') return undefined;
  const o = j as Record<string, unknown>;
  if (typeof o.text !== 'string' || !o.text.trim() || o.text.length > 1000) return undefined;
  const lang = typeof o.lang === 'string' ? o.lang.slice(0, 5) : undefined;
  let eta: number | undefined;
  if (o.etaMinutes !== undefined) {
    const n = Number(o.etaMinutes);
    if (Number.isFinite(n) && n >= 0 && n <= 600) eta = n;
  }
  return { text: o.text.trim(), lang, etaMinutes: eta };
}
