// Risk Radar: six deterministic Jira signals -> at most three spoken risks,
// each with evidence (the issues and the rule that fired), a confirmed/estimated label,
// and exactly one proposed fix. The rules run in code; an LLM may only reword the result.

import type { Issue, Lang, Op, Person } from '../types';
import { isBlocked, isOpen } from '../types';

export type SignalId = 'blocked-too-long' | 'blocking-chain' | 'overdue' | 'due-soon-not-started' | 'owner-overload' | 'stale';

export interface RadarConfig {
  blockedDays: number;
  dueSoonDays: number;
  overloadShare: number;
  /** Overload needs at least this many open issues in scope, or 3 of 5 would always fire. */
  overloadMinOpen: number;
  staleDays: number;
  chainDepth: number;
  maxRisks: number;
}

export const DEFAULT_RADAR: RadarConfig = {
  blockedDays: 3,
  dueSoonDays: 3,
  overloadShare: 0.4,
  overloadMinOpen: 6,
  staleDays: 7,
  chainDepth: 2,
  maxRisks: 3,
};

export interface Signal {
  id: SignalId;
  weight: number;
  label: 'confirmed' | 'estimated';
  /** Issue keys that prove the signal. */
  evidence: string[];
  /** Human-readable rule that fired, with the measured value. */
  rule: string;
  /** Numbers behind the rule, for speech templates and tests. */
  facts: Record<string, number | string>;
}

export interface ProposedFix {
  kind: 'follow-up' | 'reassign' | 'ping-owner';
  /** Spoken, verb first, completes "Want me to ...?" */
  say: Record<Lang, string>;
  ops: Op[];
}

export interface Risk {
  rootKey: string;
  summary: string;
  score: number;
  label: 'confirmed' | 'estimated';
  signals: Signal[];
  /** Every issue key cited, root first. */
  sources: string[];
  fix: ProposedFix;
}

const DAY = 86_400_000;

function daysBetween(fromIso: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(fromIso).getTime()) / DAY);
}

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Days from today until due (negative = overdue). Uses calendar dates in UTC. */
function daysUntil(due: string, now: Date): number {
  return Math.round((Date.parse(due + 'T00:00:00Z') - Date.parse(dateOnly(now) + 'T00:00:00Z')) / DAY);
}

function addBusinessDays(now: Date, n: number): string {
  const d = new Date(Date.parse(dateOnly(now) + 'T00:00:00Z'));
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return dateOnly(d);
}

/** Open issues downstream of `key` via "blocks" links, up to `depth` levels, no cycles. */
export function downstream(key: string, byKey: Map<string, Issue>, depth: number): string[] {
  const seen = new Set<string>([key]);
  const out: string[] = [];
  let frontier = [key];
  for (let level = 0; level < depth; level++) {
    const next: string[] = [];
    for (const k of frontier) {
      for (const b of byKey.get(k)?.blocks ?? []) {
        if (seen.has(b)) continue;
        seen.add(b);
        const issue = byKey.get(b);
        if (issue && isOpen(issue)) {
          out.push(b);
          next.push(b);
        }
      }
    }
    frontier = next;
  }
  return out;
}

export function issueSignals(issue: Issue, byKey: Map<string, Issue>, now: Date, cfg: RadarConfig): Signal[] {
  const s: Signal[] = [];
  if (!isOpen(issue)) return s;

  if (isBlocked(issue)) {
    const days = daysBetween(issue.statusChangedAt, now);
    if (days >= cfg.blockedDays) {
      s.push({
        id: 'blocked-too-long',
        weight: 3,
        label: 'confirmed',
        evidence: [issue.key],
        rule: `blocked ${days} days (threshold ${cfg.blockedDays})`,
        facts: { days },
      });
    }
    const down = downstream(issue.key, byKey, cfg.chainDepth);
    if (down.length) {
      s.push({
        id: 'blocking-chain',
        weight: 2 * down.length,
        label: 'confirmed',
        evidence: [issue.key, ...down],
        rule: `blocked issue blocks ${down.length} open ${down.length === 1 ? 'issue' : 'issues'} (${down.join(', ')})`,
        facts: { downstream: down.length },
      });
    }
  }

  if (issue.dueDate) {
    const until = daysUntil(issue.dueDate, now);
    if (until < 0) {
      s.push({
        id: 'overdue',
        weight: 2,
        label: 'confirmed',
        evidence: [issue.key],
        rule: `due ${issue.dueDate}, ${-until} ${-until === 1 ? 'day' : 'days'} overdue`,
        facts: { daysOverdue: -until },
      });
    } else if (until <= cfg.dueSoonDays && issue.statusCategory === 'todo') {
      s.push({
        id: 'due-soon-not-started',
        weight: 2,
        label: 'estimated',
        evidence: [issue.key],
        rule: `due in ${until} ${until === 1 ? 'day' : 'days'} and still To Do`,
        facts: { daysLeft: until },
      });
    }
  }

  if (issue.statusCategory === 'inprogress' && !isBlocked(issue)) {
    const idle = daysBetween(issue.updatedAt, now);
    if (idle >= cfg.staleDays) {
      s.push({
        id: 'stale',
        weight: 1,
        label: 'estimated',
        evidence: [issue.key],
        rule: `In Progress with no update for ${idle} days`,
        facts: { idleDays: idle },
      });
    }
  }
  return s;
}

interface Overload {
  person: Person;
  keys: string[];
  share: number;
  open: number;
}

export function findOverloads(open: Issue[], cfg: RadarConfig): Overload[] {
  if (open.length < cfg.overloadMinOpen) return [];
  const by = new Map<string, { person: Person; keys: string[] }>();
  for (const i of open) {
    if (!i.assignee) continue;
    const e = by.get(i.assignee.accountId) ?? { person: i.assignee, keys: [] };
    e.keys.push(i.key);
    by.set(i.assignee.accountId, e);
  }
  return [...by.values()]
    .map((e) => ({ ...e, share: e.keys.length / open.length, open: open.length }))
    .filter((e) => e.share > cfg.overloadShare)
    .sort((a, b) => b.share - a.share);
}

const PRIORITY_RANK: Record<string, number> = { Highest: 0, High: 1, Medium: 2, Low: 3, Lowest: 4 };

function firstName(p?: Person): string {
  return p?.displayName.split(' ')[0] ?? 'the owner';
}

function proposeFix(
  root: Issue,
  signals: Signal[],
  ctx: { now: Date; open: Issue[]; overload?: Overload; accountId: string },
): ProposedFix {
  const ids = new Set(signals.map((s) => s.id));
  const audit = `(proposed by HeyBrief Risk Radar, approved by voice by [~accountid:${ctx.accountId}])`;

  if (ids.has('blocked-too-long') || ids.has('blocking-chain')) {
    const due = addBusinessDays(ctx.now, 2);
    const owner = root.assignee;
    const dow = new Date(due + 'T00:00:00Z').getUTCDay();
    const name = firstName(owner);
    return {
      kind: 'follow-up',
      say: {
        en: `create a follow-up for ${name} due ${WEEKDAY.en[dow]}`,
        fr: `crée une tâche de suivi pour ${name} pour ${WEEKDAY.fr[dow]}`,
        ar: `أنشئ مهمة متابعة لـ ${name} يوم ${WEEKDAY.ar[dow]}`,
      },
      ops: [
        {
          type: 'create-issue',
          projectKey: root.projectKey,
          summary: `Unblock ${root.key}: ${root.summary}`.slice(0, 250),
          assigneeId: owner?.accountId,
          dueDate: due,
          linkToKey: root.key,
        },
        { type: 'comment', issueKey: root.key, body: `Follow-up created to unblock this issue. ${audit}` },
      ],
    };
  }

  if (ctx.overload && ids.has('owner-overload')) {
    const counts = new Map<string, { p: Person; n: number }>();
    for (const i of ctx.open) {
      if (!i.assignee || i.assignee.accountId === ctx.overload.person.accountId) continue;
      const c = counts.get(i.assignee.accountId) ?? { p: i.assignee, n: 0 };
      c.n++;
      counts.set(i.assignee.accountId, c);
    }
    const target = [...counts.values()].sort((a, b) => a.n - b.n || a.p.displayName.localeCompare(b.p.displayName))[0];
    if (target) {
      const to = firstName(target.p);
      return {
        kind: 'reassign',
        say: {
          en: `reassign ${root.key} to ${to}`,
          fr: `réassigne ${root.key} à ${to}`,
          ar: `أعيد إسناد ${root.key} إلى ${to}`,
        },
        ops: [
          { type: 'assign', issueKey: root.key, accountId: target.p.accountId },
          {
            type: 'comment',
            issueKey: root.key,
            body: `Reassigned from ${ctx.overload.person.displayName} (${ctx.overload.keys.length} of ${ctx.overload.open} open issues) to balance load. ${audit}`,
            mentions: [target.p.accountId, ctx.overload.person.accountId],
          },
        ],
      };
    }
  }

  const name = firstName(root.assignee);
  const ask = ids.has('overdue') ? 'Can you share a new date?' : 'Can you share a quick status?';
  return {
    kind: 'ping-owner',
    say: { en: `ping ${name} for a new date`, fr: `relance ${name}`, ar: `أذكّر ${name}` },
    ops: [
      {
        type: 'comment',
        issueKey: root.key,
        body: `${ask} ${audit}`,
        mentions: root.assignee ? [root.assignee.accountId] : [],
      },
    ],
  };
}

/**
 * Score every open issue, attach overload as its own risk rooted on one reassignable issue,
 * and return the top risks (score desc, confirmed first, then key for determinism).
 */
export function runRadar(issues: Issue[], now: Date, accountId: string, cfg: RadarConfig = DEFAULT_RADAR): Risk[] {
  const byKey = new Map(issues.map((i) => [i.key, i]));
  const open = issues.filter(isOpen);
  const risks: Risk[] = [];

  for (const issue of open) {
    const signals = issueSignals(issue, byKey, now, cfg);
    if (!signals.length) continue;
    risks.push(buildRisk(issue, signals, { now, open, accountId }));
  }

  for (const ov of findOverloads(open, cfg)) {
    // Root: the overloaded person's most movable issue: not blocked, not downstream of a blocker,
    // To Do first, then highest priority, then earliest due date, then key.
    const candidates = open
      .filter(
        (i) => ov.keys.includes(i.key) && !isBlocked(i) && i.blockedBy.every((b) => !byKey.get(b) || !isOpen(byKey.get(b)!)),
      )
      .sort(
        (a, b) =>
          (a.statusCategory === 'todo' ? 0 : 1) - (b.statusCategory === 'todo' ? 0 : 1) ||
          PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
          (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
          a.key.localeCompare(b.key, 'en', { numeric: true }),
      );
    const root = candidates[0];
    if (!root) continue;
    const pct = Math.round(ov.share * 100);
    const signal: Signal = {
      id: 'owner-overload',
      weight: 2,
      label: 'estimated',
      evidence: ov.keys,
      rule: `${ov.person.displayName} holds ${ov.keys.length} of ${ov.open} open issues (${pct}%, threshold ${Math.round(cfg.overloadShare * 100)}%)`,
      facts: { held: ov.keys.length, open: ov.open, pct },
    };
    const existing = risks.find((r) => r.rootKey === root.key);
    if (existing) {
      existing.signals.push(signal);
      Object.assign(existing, buildRisk(root, existing.signals, { now, open, accountId, overload: ov }));
    } else {
      risks.push(buildRisk(root, [signal], { now, open, accountId, overload: ov }));
    }
  }

  // An issue that only shows up as downstream of a higher risk is not repeated as its own risk.
  risks.sort(
    (a, b) =>
      b.score - a.score ||
      (a.label === 'confirmed' ? 0 : 1) - (b.label === 'confirmed' ? 0 : 1) ||
      a.rootKey.localeCompare(b.rootKey, 'en', { numeric: true }),
  );
  const out: Risk[] = [];
  const covered = new Set<string>();
  for (const r of risks) {
    if (covered.has(r.rootKey)) continue;
    out.push(r);
    for (const s of r.signals) if (s.id !== 'owner-overload') s.evidence.forEach((k) => covered.add(k));
    if (out.length >= cfg.maxRisks) break;
  }
  return out;
}

function buildRisk(
  root: Issue,
  signals: Signal[],
  ctx: { now: Date; open: Issue[]; accountId: string; overload?: Overload },
): Risk {
  const base = signals.reduce((n, s) => n + s.weight, 0);
  const score = base + (root.priority === 'High' || root.priority === 'Highest' ? 1 : 0);
  const sources = [root.key, ...new Set(signals.flatMap((s) => s.evidence).filter((k) => k !== root.key))];
  return {
    rootKey: root.key,
    summary: root.summary,
    score,
    label: signals.some((s) => s.label === 'confirmed') ? 'confirmed' : 'estimated',
    signals,
    sources,
    fix: proposeFix(root, signals, ctx),
  };
}

/** Spoken weekday names; a fixed table so speech never depends on the runtime's ICU data. Sunday first. */
const WEEKDAY = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  fr: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'],
  ar: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
};
