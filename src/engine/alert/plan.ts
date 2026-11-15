// Response plan: when an urgent incident or a vendor outage touches open work, HeyBrief proposes
// ONE plan instead of one action: who takes it, who is told, what is tracked, and which release is at
// risk. Pure and deterministic. Nothing runs until the person says yes (same confirm gate, receipt
// and Undo as every other change). Never "autonomous": approval is the point.

import type { Issue, Lang, Op } from '../types';
import { isOpen } from '../types';
import type { Alert } from './detect';

/** A release counts as "at risk" when it ships within this many days. */
export const RELEASE_WINDOW_DAYS = 7;

const DAY = 86_400_000;
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
const daysUntil = (iso: string, now: Date) =>
  Math.round((Date.parse(iso + 'T00:00:00Z') - Date.parse(dateOnly(now) + 'T00:00:00Z')) / DAY);

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

export interface ReleaseAtRisk {
  name: string;
  releaseDate: string;
  daysLeft: number;
  keys: string[];
}

/** The soonest unreleased fix version, among the given issues, that ships within the window. Pure. */
export function releaseAtRisk(issues: Issue[], now: Date, windowDays = RELEASE_WINDOW_DAYS): ReleaseAtRisk | undefined {
  const by = new Map<string, ReleaseAtRisk>();
  for (const i of issues) {
    for (const v of i.fixVersions ?? []) {
      if (v.released || !v.releaseDate) continue;
      const left = daysUntil(v.releaseDate, now);
      if (left < 0 || left > windowDays) continue;
      const r = by.get(v.name) ?? { name: v.name, releaseDate: v.releaseDate, daysLeft: left, keys: [] };
      if (!r.keys.includes(i.key)) r.keys.push(i.key);
      by.set(v.name, r);
    }
  }
  return [...by.values()].sort((a, b) => a.daysLeft - b.daysLeft || a.name.localeCompare(b.name))[0];
}

const ownersOf = (issues: Issue[], me: string) => [
  ...new Set(issues.map((i) => i.assignee?.accountId).filter((a): a is string => !!a && a !== me)),
];

const RELEASE_SAY: Record<Lang, (r: ReleaseAtRisk) => string> = {
  en: (r) => `Release ${r.name}, due ${r.releaseDate}, is at risk.`,
  fr: (r) => `La version ${r.name}, prévue le ${r.releaseDate}, est en danger.`,
  ar: (r) => `الإصدار ${r.name} المقرر في ${r.releaseDate} في خطر.`,
};

/** Sentence for the spoken alert when a release is at risk; empty otherwise. */
export function releaseLine(a: Alert, lang: Lang): string {
  if (!a.facts.release) return '';
  return RELEASE_SAY[lang]({
    name: String(a.facts.release),
    releaseDate: String(a.facts.releaseDate),
    daysLeft: Number(a.facts.releaseDays),
    keys: [],
  });
}

/**
 * Turn an incident or outside alert into a response plan. Other alerts pass through unchanged.
 * - Unowned incident: take it and start it (as before), tell the team, open a post-incident review.
 * - Vendor outage: note on each affected issue that names its owner, plus one tracking issue so the
 *   outage shows up on the board until someone closes it. It is not linked as a blocker: a link would
 *   make HeyBrief raise a second alert about its own tracker.
 * - Either way: the soonest release (fix version) that ships within 7 days among the issues involved
 *   is named as at risk, and the alert becomes critical. Evidence: the issues carrying that version.
 */
export function withResponsePlan(a: Alert, issues: Issue[], now: Date, me: string): Alert {
  const byKey = new Map(issues.map((i) => [i.key, i]));
  const involved = a.evidence.map((k) => byKey.get(k)).filter((i): i is Issue => !!i && isOpen(i));

  if (a.kind === 'incident' && a.action.kind === 'take') {
    const root = byKey.get(a.issueKey);
    if (!root) return a;
    const release = releaseAtRisk([root, ...issues.filter((i) => root.blocks.includes(i.key))], now);
    const review: Op = {
      type: 'create-issue',
      projectKey: root.projectKey,
      summary: `Post-incident review: ${root.summary}`.slice(0, 200),
      assigneeId: me,
      dueDate: addBusinessDays(now, 2),
    };
    return {
      ...a,
      severity: 'critical',
      evidence: release ? [...new Set([...a.evidence, ...release.keys])] : a.evidence,
      rule: release ? `${a.rule}; release ${release.name} ships ${release.releaseDate}` : a.rule,
      facts: release
        ? { ...a.facts, release: release.name, releaseDate: release.releaseDate, releaseDays: release.daysLeft }
        : a.facts,
      action: {
        kind: 'plan',
        say: {
          en: `run the response plan: assign ${root.key} to you and start it, tell the team, and open a post-incident review`,
          fr: `lance le plan de réponse : vous assigner ${root.key}, le démarrer, prévenir l'équipe et ouvrir une revue post-incident`,
          ar: `أنفّذ خطة الاستجابة: أسند ${root.key} إليك وأبدأها وأبلغ الفريق وأفتح مراجعة ما بعد الحادث`,
        },
        ops: [...a.action.ops, review],
      },
    };
  }

  if (a.kind === 'outside') {
    if (!involved.length) return a;
    const vendor = String(a.facts.vendor);
    const release = releaseAtRisk(involved, now);
    const ops: Op[] = a.action.ops.map((op) => {
      if (op.type !== 'comment') return op;
      const owner = byKey.get(op.issueKey)?.assignee?.accountId;
      return owner && owner !== me ? { ...op, mentions: [owner] } : op;
    });
    ops.push({
      type: 'create-issue',
      projectKey: involved[0].projectKey,
      summary: `Track ${vendor} outage: ${a.summary}`.slice(0, 200),
      assigneeId: me,
      dueDate: dateOnly(now),
    });
    const owners = ownersOf(involved, me).length;
    const list = involved.map((i) => i.key).join(', ');
    return {
      ...a,
      severity: release ? 'critical' : a.severity,
      evidence: release ? [...new Set([...a.evidence, ...release.keys])] : a.evidence,
      rule: release ? `${a.rule}; release ${release.name} ships ${release.releaseDate}` : a.rule,
      facts: release
        ? { ...a.facts, owners, release: release.name, releaseDate: release.releaseDate, releaseDays: release.daysLeft }
        : { ...a.facts, owners },
      action: {
        kind: 'plan',
        say: {
          en: `run the response plan: note the ${vendor} outage on ${list}, tell their owners, and open a tracking issue`,
          fr: `lance le plan de réponse : noter la panne ${vendor} sur ${list}, prévenir les responsables et ouvrir un ticket de suivi`,
          ar: `أنفّذ خطة الاستجابة: أسجّل عطل ${vendor} على ${list} وأبلغ المسؤولين وأفتح تذكرة متابعة`,
        },
        ops,
      },
    };
  }

  return a;
}
