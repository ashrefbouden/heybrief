// Rovo actions. The same functions are exposed as MCP tools through the rovo:mcp module,
// so Claude (or any MCP client) gets exactly the same behaviour as the Rovo agent.
//
// UNVERIFIED until M0: where Forge puts the invoking accountId for action functions.
// accountIdOf() checks the known locations and refuses to act without one.

import type { Scope } from '../engine/types';
import { riskToJson } from '../engine/heybrief';
import { searchDocs } from '../forge/confluence';
import { engineFor } from './wiring';

type Payload = Record<string, unknown> & { context?: Record<string, any> };

function accountIdOf(payload: Payload, context?: Record<string, any>): string {
  const id =
    context?.principal?.accountId ?? context?.accountId ?? payload.context?.accountId ?? payload.context?.principal?.accountId;
  if (typeof id !== 'string' || !id) throw new Error('No user context: HeyBrief only acts on behalf of a signed-in user.');
  return id;
}

const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : undefined);

function reply(a: { speech: string; pendingId?: string; data?: unknown; lang?: string }) {
  return JSON.stringify({
    speech: a.speech,
    lang: a.lang,
    // The agent prompt tells Rovo to show this and wait for the user's own "yes".
    confirmation_id: a.pendingId,
    needs_confirmation: Boolean(a.pendingId),
    data: a.data,
  });
}

export async function myDay(payload: Payload, context?: Record<string, any>) {
  const accountId = accountIdOf(payload, context);
  const { hb } = await engineFor({ kind: 'user' });
  const eta = Number(payload.minutes);
  return reply(
    await hb.brief(accountId, { etaMinutes: Number.isFinite(eta) && eta > 0 ? eta : undefined, lang: str(payload.language, 5) }),
  );
}

export async function readIssue(payload: Payload, context?: Record<string, any>) {
  accountIdOf(payload, context);
  const key = str(payload.issue_key, 30)?.toUpperCase();
  if (!key || !/^[A-Z][A-Z0-9_]{0,19}-\d+$/.test(key)) return reply({ speech: 'Give me an issue key like MP-12.' });
  const { deps } = await engineFor({ kind: 'user' });
  const i = await deps.jira.getIssue(key);
  if (!i) return reply({ speech: `I can't find ${key}.` });
  const who = i.assignee ? `, assigned to ${i.assignee.displayName}` : ', unassigned';
  const due = i.dueDate ? `, due ${i.dueDate}` : '';
  return reply({ speech: `${i.key}: ${i.summary}. ${i.status}${who}${due}.`, data: i });
}

export async function searchDocsAction(payload: Payload, context?: Record<string, any>) {
  accountIdOf(payload, context);
  const q = str(payload.query, 200);
  if (!q) return reply({ speech: 'What should I look for?' });
  const results = await searchDocs(q);
  const speech = results.length
    ? `Top page: ${results[0].title}. ${results[0].excerpt}`.slice(0, 400)
    : `No pages found for ${q}.`;
  return reply({ speech, data: results });
}

export async function voiceStandup(payload: Payload, context?: Record<string, any>) {
  const accountId = accountIdOf(payload, context);
  const update = str(payload.update);
  if (!update) return reply({ speech: 'Tell me your update, for example: I finished MP-12.' });
  const { hb } = await engineFor({ kind: 'user' });
  return reply(await hb.talkback(accountId, update, str(payload.language, 5)));
}

export async function riskRadar(payload: Payload, context?: Record<string, any>) {
  const accountId = accountIdOf(payload, context);
  const raw = str(payload.scope, 30)?.trim().toUpperCase();
  const scope: Scope =
    !raw || raw === 'ME'
      ? { kind: 'me', accountId }
      : /^[A-Z][A-Z0-9_]{0,19}-\d+$/.test(raw)
        ? { kind: 'epic', epicKey: raw }
        : /^[A-Z][A-Z0-9_]{0,19}$/.test(raw)
          ? { kind: 'project', projectKey: raw }
          : { kind: 'me', accountId };
  const { hb } = await engineFor({ kind: 'user' });
  return reply(await hb.radar(accountId, scope, str(payload.language, 5)));
}

export async function explainRisk(payload: Payload, context?: Record<string, any>) {
  const accountId = accountIdOf(payload, context);
  const n = Math.min(3, Math.max(1, Number(payload.rank) || 1));
  const { hb } = await engineFor({ kind: 'user' });
  return reply(await hb.why(accountId, n, str(payload.language, 5)));
}

export async function confirmChange(payload: Payload, context?: Record<string, any>) {
  const accountId = accountIdOf(payload, context);
  const id = str(payload.confirmation_id, 100);
  const userReply = str(payload.user_reply, 200);
  if (!id || !userReply) return reply({ speech: 'I need the confirmation id and the user’s exact reply.' });
  const { hb } = await engineFor({ kind: 'user' });
  return reply(await hb.confirm(accountId, userReply, id));
}

export { riskToJson };
