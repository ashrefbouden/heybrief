// Drive-sized brief: the Siri Shortcut sends the ETA from "Get Travel Time";
// the brief fits the drive ("11 minutes: 3 things, 1 decision").
// Ranking here is a minimal stand-in; the MVP's ranking.ts replaces rankMyDay when ported.

import { capWords, joinList, T } from '../speak';
import type { Issue, Lang } from '../types';
import { isBlocked, isOpen } from '../types';
import type { Risk } from '../risk/radar';

export interface DriveBudget {
  things: number;
  decisions: number;
}

/** About 150 spoken words a minute, but a driver needs room to think: keep it short. */
export function budgetFor(etaMinutes: number | undefined): DriveBudget {
  if (etaMinutes === undefined || !Number.isFinite(etaMinutes)) return { things: 3, decisions: 1 };
  if (etaMinutes < 5) return { things: 1, decisions: 0 };
  if (etaMinutes < 15) return { things: 3, decisions: 1 };
  return { things: 5, decisions: 1 };
}

const PRIORITY: Record<string, number> = { Highest: 0, High: 1, Medium: 2, Low: 3, Lowest: 4 };

export function rankMyDay(issues: Issue[], accountId: string, today: string): Issue[] {
  const mine = issues.filter((i) => isOpen(i) && i.assignee?.accountId === accountId);
  const urgency = (i: Issue) => {
    if (isBlocked(i)) return 0;
    if (i.dueDate && i.dueDate < today) return 1;
    if (i.dueDate && i.dueDate === today) return 2;
    if (i.statusCategory === 'inprogress') return 3;
    return 4;
  };
  return mine.sort(
    (a, b) =>
      urgency(a) - urgency(b) ||
      PRIORITY[a.priority] - PRIORITY[b.priority] ||
      (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
      a.key.localeCompare(b.key, 'en', { numeric: true }),
  );
}

function issueLine(i: Issue, lang: Lang, today: string): string {
  const s = i.summary.split(/\s+/).slice(0, 6).join(' ');
  if (isBlocked(i))
    return lang === 'fr' ? `${i.key} bloqué, ${s}` : lang === 'ar' ? `${i.key} محظور، ${s}` : `${i.key} is blocked, ${s}`;
  if (i.dueDate && i.dueDate < today)
    return lang === 'fr' ? `${i.key} en retard, ${s}` : lang === 'ar' ? `${i.key} متأخر، ${s}` : `${i.key} overdue, ${s}`;
  return `${i.key}, ${s}`;
}

const DAY_MS = 86_400_000;

/** Someone else's open work that waits on one of yours: "who is waiting on me?". */
export function waitingOnMe(issues: Issue[], accountId: string): Array<{ mine: string; theirs: string; who: string }> {
  const byKey = new Map(issues.map((i) => [i.key, i]));
  const out: Array<{ mine: string; theirs: string; who: string }> = [];
  for (const m of issues) {
    if (!isOpen(m) || m.assignee?.accountId !== accountId) continue;
    for (const k of m.blocks) {
      const o = byKey.get(k);
      if (o && isOpen(o) && o.assignee && o.assignee.accountId !== accountId)
        out.push({ mine: m.key, theirs: o.key, who: o.assignee.displayName.split(' ')[0] });
    }
  }
  return out;
}

/** Open issues on you created in the last 24 hours: "what changed since yesterday?". */
export function newOnMe(issues: Issue[], accountId: string, now: Date): string[] {
  return issues
    .filter((i) => isOpen(i) && i.assignee?.accountId === accountId && i.createdAt && now.getTime() - Date.parse(i.createdAt) < DAY_MS)
    .map((i) => i.key);
}

function waitingLine(w: { mine: string; theirs: string; who: string }, lang: Lang): string {
  if (lang === 'fr') return `${w.who} attend votre ${w.mine} pour ${w.theirs}.`;
  if (lang === 'ar') return `${w.who} ينتظر ${w.mine} الخاصة بك من أجل ${w.theirs}.`;
  return `${w.who} is waiting on your ${w.mine} for ${w.theirs}.`;
}

function newLine(keys: string[], lang: Lang): string {
  const list = joinList(keys, lang);
  if (lang === 'fr') return `Nouveau depuis hier : ${list}.`;
  if (lang === 'ar') return `جديد منذ أمس: ${list}.`;
  return `New on you since yesterday: ${list}.`;
}

export function driveBrief(input: {
  issues: Issue[];
  risks: Risk[];
  accountId: string;
  now: Date;
  lang: Lang;
  etaMinutes?: number;
}): { speech: string; keys: string[]; decision?: Risk; lead?: string; ask?: string; facts?: string } {
  const { lang } = input;
  const t = T[lang];
  const today = input.now.toISOString().slice(0, 10);
  const budget = budgetFor(input.etaMinutes);
  const ranked = rankMyDay(input.issues, input.accountId, today).slice(0, budget.things);
  const decision = budget.decisions ? input.risks[0] : undefined;
  if (!ranked.length && !decision) return { speech: t.nothingToday, keys: [] };

  const minutes = input.etaMinutes !== undefined ? Math.max(1, Math.round(input.etaMinutes)) : undefined;
  const header = minutes !== undefined ? t.driveHeader(minutes, ranked.length, decision ? 1 : 0) : '';
  const body = ranked.length
    ? joinList(
        ranked.map((i) => issueLine(i, lang, today)),
        lang,
      ) + '.'
    : '';
  // With room for more than one item, also say who waits on you and what is new.
  let extra = '';
  if (budget.things >= 3) {
    const w = waitingOnMe(input.issues, input.accountId)[0];
    if (w) extra += ` ${waitingLine(w, lang)}`;
    const fresh = newOnMe(input.issues, input.accountId, input.now).slice(0, 2);
    if (fresh.length) extra += ` ${newLine(fresh, lang)}`;
  }
  const ask = decision ? ` ${t.want(decision.fix.say[lang])}` : '';
  const decisionLead = decision ? ` ${lang === 'fr' ? 'Risque' : lang === 'ar' ? 'خطر' : 'Risk'}: ${decision.rootKey}.` : '';
  const askWords = ask.trim() ? ask.trim().split(/\s+/).length : 0;
  const lead = capWords(`${header} ${body}${decisionLead}${extra}`.trim(), 60 - askWords);
  const speech = `${lead}${ask}`.trim();
  return { speech, keys: ranked.map((i) => i.key), decision, lead, ask: ask.trim(), facts: factsFor(ranked, input) };
}

/** Plain facts behind a brief, for the LLM phraser: every key it may name, and nothing else. */
function factsFor(ranked: Issue[], input: { issues: Issue[]; risks: Risk[]; accountId: string; now: Date }): string {
  const lines = ranked.map(
    (i) => `${i.key}: ${i.summary}; status ${i.status}${i.dueDate ? `; due ${i.dueDate}` : ''}${isBlocked(i) ? '; blocked' : ''}`,
  );
  for (const w of waitingOnMe(input.issues, input.accountId).slice(0, 1))
    lines.push(`${w.who} waits on ${w.mine} for ${w.theirs}`);
  const fresh = newOnMe(input.issues, input.accountId, input.now).slice(0, 2);
  if (fresh.length) lines.push(`new since yesterday: ${fresh.join(', ')}`);
  if (input.risks[0]) lines.push(`top risk: ${input.risks[0].rootKey}`);
  return lines.join('\n');
}
