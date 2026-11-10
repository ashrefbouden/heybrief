// Heads-up: urgent Jira events that are worth interrupting someone for.
// Borrowed from WorldGuard: deterministic rules, a risk level kept apart from confidence
// ("high severity but only a keyword match means verify before acting"), one playbook action
// per alert type, and a human yes before anything is written. No LLM, no network beyond Jira.

import type { Issue, Lang, Op } from '../types';
import { isBlocked, isOpen } from '../types';
import { words } from '../words';

export type AlertKind = 'incident' | 'security' | 'deadline-collision' | 'due-today';

export interface Alert {
  /** Stable id for dedupe: the same event never interrupts twice. */
  id: string;
  kind: AlertKind;
  severity: 'critical' | 'urgent';
  /**
   * WorldGuard's confidence split. confirmed: Jira fields prove it (issue type, label, priority, links, due date).
   * keyword: only words in the summary suggest it, so the speech says "verify".
   */
  confidence: 'confirmed' | 'keyword';
  issueKey: string;
  summary: string;
  /** Minutes since the issue was created (or entered its status when created is unknown). */
  ageMinutes: number;
  /** Rule that fired, with the measured values. Used for "why?". */
  rule: string;
  /** Issue keys that prove the alert, root first. */
  evidence: string[];
  facts: Record<string, string | number>;
  action: AlertAction;
}

export interface AlertAction {
  kind: 'take' | 'ping' | 'start' | 'unblock';
  /** Verb first, completes "Want me to ...?" */
  say: Record<Lang, string>;
  ops: Op[];
}

export interface AlertConfig {
  /** Downstream due within this many days makes a blocker a deadline collision (0 = today, 1 = tomorrow). */
  collisionDays: number;
  /** Security and incident alerts only fire for issues created in this window, so old backlog items don't interrupt. */
  freshDays: number;
}

export const DEFAULT_ALERTS: AlertConfig = { collisionDays: 1, freshDays: 7 };

// Words in summaries. Kept narrow on purpose: an interruption that cries wolf gets muted.
const INCIDENT_WORDS = words([
  'outage',
  'down',
  'is down',
  'incident',
  'sev ?-?[01]',
  'p0',
  'p1',
  'production',
  'prod',
  '5\\d\\d errors?',
  'not loading',
  'crash(?:es|ing)?',
  'panne',
  'hors service',
  'en production',
  'indisponible',
  'عطل',
  'انقطاع',
  'توقف',
  'معطل',
]);
const SECURITY_WORDS = words([
  'security',
  'vulnerabilit(?:y|ies)',
  'cve-\\d{4}-\\d+',
  'breach',
  'leak(?:ed)?',
  'exposed (?:secret|key|token|password|credentials?)',
  '(?:secret|api key|token|password|credentials?) (?:leak(?:ed)?|exposed)',
  'exploit(?:ed)?',
  'injection',
  'xss',
  'ransomware',
  'phishing',
  'malware',
  'faille',
  'fuite',
  'vulnérabilité',
  'piratage',
  'sécurité',
  'ثغرة',
  'اختراق',
  'تسريب',
  'أمني',
  'الأمن',
]);
const INCIDENT_TYPE = /incident|outage|problem/i;
const SECURITY_TYPE = /security|vulnerab/i;
const INCIDENT_LABEL = /^(incident|outage|sev-?[01]|p[01]|production)$/i;
const SECURITY_LABEL = /^(security|cve|vulnerability|secops)$/i;

const DAY = 86_400_000;
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
const daysUntil = (due: string, now: Date) =>
  Math.round((Date.parse(due + 'T00:00:00Z') - Date.parse(dateOnly(now) + 'T00:00:00Z')) / DAY);
const minutesSince = (iso: string | undefined, now: Date) =>
  iso ? Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000)) : 0;
const firstName = (name?: string) => name?.split(' ')[0];

function bornAt(i: Issue): string {
  return i.createdAt ?? i.statusChangedAt;
}

function fresh(i: Issue, now: Date, cfg: AlertConfig): boolean {
  return minutesSince(bornAt(i), now) <= cfg.freshDays * 24 * 60;
}

function classify(i: Issue, typeRe: RegExp, labelRe: RegExp, wordRe: RegExp): 'confirmed' | 'keyword' | null {
  if ((i.issueType && typeRe.test(i.issueType)) || (i.labels ?? []).some((l) => labelRe.test(l))) return 'confirmed';
  if (wordRe.test(i.summary)) return 'keyword';
  return null;
}

const AUDIT = (accountId: string) => `(HeyBrief urgent alert, approved by voice by [~accountid:${accountId}])`;

/**
 * The playbook: unassigned -> the speaker takes it; the speaker's own and not started -> start it;
 * someone else's -> ping them with a mention, which Jira turns into a notification.
 */
function takeOrPing(i: Issue, me: string, why: string): AlertAction {
  if (!i.assignee) {
    return {
      kind: 'take',
      say: {
        en: `assign ${i.key} to you and tell the team you're on it`,
        fr: `vous assigne ${i.key} et prévienne l'équipe que vous êtes dessus`,
        ar: `أسند ${i.key} إليك وأبلغ الفريق أنك تتولاها`,
      },
      ops: [
        { type: 'assign', issueKey: i.key, accountId: me },
        {
          type: 'comment',
          issueKey: i.key,
          body: `I'm on it. ${why} ${AUDIT(me)}`,
          mentions: i.reporter && i.reporter.accountId !== me ? [i.reporter.accountId] : [],
        },
      ],
    };
  }
  if (i.assignee.accountId === me && i.statusCategory === 'todo') {
    return {
      kind: 'start',
      say: {
        en: `move ${i.key} to In Progress now`,
        fr: `passe ${i.key} en cours maintenant`,
        ar: `أنقل ${i.key} إلى قيد التنفيذ الآن`,
      },
      ops: [
        { type: 'transition', issueKey: i.key, toCategory: 'inprogress' },
        { type: 'comment', issueKey: i.key, body: `Started now. ${why} ${AUDIT(me)}` },
      ],
    };
  }
  const name = firstName(i.assignee.displayName) ?? 'the owner';
  return {
    kind: 'ping',
    say: {
      en: `ping ${name} on ${i.key} right now`,
      fr: `relance ${name} sur ${i.key} tout de suite`,
      ar: `أنبّه ${name} بشأن ${i.key} فورا`,
    },
    ops: [
      {
        type: 'comment',
        issueKey: i.key,
        body: `Urgent: ${why} Can you confirm you're on it? ${AUDIT(me)}`,
        mentions: [i.assignee.accountId],
      },
    ],
  };
}

const PRIORITY_HIGH = new Set(['Highest', 'High']);

/** Every urgent alert in the issues, most urgent first. Pure: same input, same output. */
export function detectAlerts(issues: Issue[], now: Date, me: string, cfg: AlertConfig = DEFAULT_ALERTS): Alert[] {
  const byKey = new Map(issues.map((i) => [i.key, i]));
  const out: Alert[] = [];
  const seen = new Set<string>();
  const push = (a: Alert) => {
    // One alert per issue: the first (most specific) rule wins.
    if (seen.has(a.issueKey)) return;
    seen.add(a.issueKey);
    out.push(a);
  };

  for (const i of issues) {
    if (!isOpen(i)) continue;
    const age = minutesSince(bornAt(i), now);

    // 1. Incident or outage at top priority that nobody has picked up.
    const inc = classify(i, INCIDENT_TYPE, INCIDENT_LABEL, INCIDENT_WORDS);
    const unowned = !i.assignee || i.statusCategory === 'todo';
    if (inc && fresh(i, now, cfg) && unowned && (i.priority === 'Highest' || (inc === 'confirmed' && i.priority === 'High'))) {
      const why = `${i.priority} priority incident, ${i.assignee ? 'not started' : 'unassigned'}.`;
      push({
        id: `incident:${i.key}`,
        kind: 'incident',
        severity: 'critical',
        confidence: inc,
        issueKey: i.key,
        summary: i.summary,
        ageMinutes: age,
        rule: `${i.priority} priority ${inc === 'confirmed' ? `incident (${i.issueType ?? 'label'})` : 'issue with incident words in the summary'}, ${i.assignee ? `assigned to ${i.assignee.displayName} but not started` : 'unassigned'}`,
        evidence: [i.key],
        facts: { priority: i.priority, owner: i.assignee?.displayName ?? '' },
        action: takeOrPing(i, me, why),
      });
      continue;
    }

    // 2. Security issue, fresh. Critical at High or above.
    const sec = classify(i, SECURITY_TYPE, SECURITY_LABEL, SECURITY_WORDS);
    if (sec && fresh(i, now, cfg) && (!i.assignee || i.statusCategory === 'todo' || PRIORITY_HIGH.has(i.priority))) {
      const why = 'Security issue reported.';
      push({
        id: `security:${i.key}`,
        kind: 'security',
        severity: PRIORITY_HIGH.has(i.priority) ? 'critical' : 'urgent',
        confidence: sec,
        issueKey: i.key,
        summary: i.summary,
        ageMinutes: age,
        rule: `${sec === 'confirmed' ? 'security issue (type or label)' : 'security words in the summary'}, ${i.priority} priority, ${i.assignee ? `owner ${i.assignee.displayName}` : 'unassigned'}`,
        evidence: [i.key],
        facts: { priority: i.priority, owner: i.assignee?.displayName ?? '' },
        action: takeOrPing(i, me, why),
      });
      continue;
    }
  }

  // 3. A blocker that will make something due today or tomorrow slip.
  for (const blocked of issues) {
    if (!isOpen(blocked) || !blocked.dueDate) continue;
    const left = daysUntil(blocked.dueDate, now);
    if (left < 0 || left > cfg.collisionDays) continue;
    for (const bk of blocked.blockedBy) {
      const blocker = byKey.get(bk);
      if (!blocker || !isOpen(blocker)) continue;
      const when = left === 0 ? 'today' : 'tomorrow';
      const name = firstName(blocker.assignee?.displayName);
      const why = `${blocker.key} blocks ${blocked.key}, which is due ${when}.`;
      const action: AlertAction = blocker.assignee
        ? {
            kind: 'unblock',
            say: {
              en: `ask ${name} to unblock ${blocked.key} today`,
              fr: `demande à ${name} de débloquer ${blocked.key} aujourd'hui`,
              ar: `أطلب من ${name} رفع العائق عن ${blocked.key} اليوم`,
            },
            ops: [
              {
                type: 'comment',
                issueKey: blocker.key,
                body: `Urgent: ${why} Can you unblock it today? ${AUDIT(me)}`,
                mentions: [blocker.assignee.accountId],
              },
            ],
          }
        : takeOrPing(blocker, me, why);
      push({
        id: `collision:${blocker.key}_${blocked.key}`,
        kind: 'deadline-collision',
        severity: blocked.priority === 'Highest' ? 'critical' : 'urgent',
        confidence: 'confirmed',
        issueKey: blocker.key,
        summary: blocker.summary,
        ageMinutes: minutesSince(isBlocked(blocker) ? blocker.statusChangedAt : bornAt(blocker), now),
        rule: `${blocker.key} (${blocker.status}) blocks ${blocked.key}, due ${blocked.dueDate} (${when})`,
        evidence: [blocker.key, blocked.key],
        facts: { blocked: blocked.key, when, daysLeft: left, owner: blocker.assignee?.displayName ?? '' },
        action,
      });
    }
  }

  // 4. Top-priority work due today that nobody has started.
  for (const i of issues) {
    if (!isOpen(i) || !i.dueDate || i.statusCategory !== 'todo' || !PRIORITY_HIGH.has(i.priority)) continue;
    if (daysUntil(i.dueDate, now) !== 0) continue;
    const why = `${i.key} is due today and not started.`;
    push({
      id: `due-today:${i.key}:${i.dueDate}`,
      kind: 'due-today',
      severity: i.priority === 'Highest' ? 'critical' : 'urgent',
      confidence: 'confirmed',
      issueKey: i.key,
      summary: i.summary,
      ageMinutes: minutesSince(bornAt(i), now),
      rule: `${i.priority} priority, due today (${i.dueDate}), still ${i.status}`,
      evidence: [i.key],
      facts: { priority: i.priority, owner: i.assignee?.displayName ?? '' },
      action: takeOrPing(i, me, why),
    });
  }

  const KIND_RANK: Record<AlertKind, number> = { incident: 0, security: 1, 'deadline-collision': 2, 'due-today': 3 };
  return out.sort(
    (a, b) =>
      (a.severity === 'critical' ? 0 : 1) - (b.severity === 'critical' ? 0 : 1) ||
      (a.confidence === 'confirmed' ? 0 : 1) - (b.confidence === 'confirmed' ? 0 : 1) ||
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      a.ageMinutes - b.ageMinutes ||
      a.issueKey.localeCompare(b.issueKey, 'en', { numeric: true }),
  );
}
