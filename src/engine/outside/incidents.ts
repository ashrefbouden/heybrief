// Outside incidents: public vendor status pages (GitHub, Cloudflare, ...) matched to open Jira work.
// HeyBrief only interrupts when an outage touches an open issue, and only proposes a note on those
// issues behind the same yes gate. Status pages are read-only public JSON: no Jira data leaves Atlassian.

import { words } from '../words';
import type { Issue, Lang, Op } from '../types';
import { isOpen } from '../types';
import type { Alert } from '../alert/detect';

export type VendorId = 'github' | 'bitbucket' | 'cloudflare' | 'npm' | 'vercel' | 'datadog';

export interface Vendor {
  name: string;
  /** Atlassian Statuspage host. The Forge adapter may fetch only these hosts (see manifest). */
  host: string;
  /**
   * Names that tie an issue to this vendor, in its summary or labels. Deliberately only the vendor's
   * own names: generic words (ci, deploy, dns) matched unrelated work and would cry wolf.
   */
  words: string[];
}

export const VENDORS: Record<VendorId, Vendor> = {
  github: { name: 'GitHub', host: 'www.githubstatus.com', words: ['github', 'github actions', 'gh actions'] },
  bitbucket: { name: 'Bitbucket', host: 'bitbucket.status.atlassian.com', words: ['bitbucket', 'bitbucket pipelines'] },
  cloudflare: { name: 'Cloudflare', host: 'www.cloudflarestatus.com', words: ['cloudflare'] },
  npm: { name: 'npm', host: 'status.npmjs.org', words: ['npm', 'npmjs'] },
  vercel: { name: 'Vercel', host: 'www.vercel-status.com', words: ['vercel'] },
  datadog: { name: 'Datadog', host: 'status.datadoghq.com', words: ['datadog'] },
};
export const VENDOR_IDS = Object.keys(VENDORS) as VendorId[];

export interface VendorIncident {
  vendor: VendorId;
  id: string;
  name: string;
  impact: 'none' | 'minor' | 'major' | 'critical';
  /** investigating, identified, monitoring... */
  status: string;
  components: string[];
  url?: string;
  startedAt: string;
}

/** Reads unresolved incidents. The Forge adapter caches; a vendor that fails is skipped, never fatal. */
export interface StatusPort {
  unresolved(vendors: VendorId[]): Promise<VendorIncident[]>;
}

export interface OutsideConfig {
  enabled: boolean;
  vendors: VendorId[];
}
export const DEFAULT_OUTSIDE: OutsideConfig = { enabled: false, vendors: VENDOR_IDS };

/** Max issues one outside alert names and notes, so the read-back stays short. */
const MAX_AFFECTED = 3;

const AUDIT = (accountId: string) => `(HeyBrief outside incident, approved by voice by [~accountid:${accountId}])`;


/**
 * Open issues an incident touches. Strong: the issue names the vendor. Weak: the issue names one of the
 * incident's own components ("GitHub Actions" -> "Actions"), which is spoken with "please verify".
 */
export function affected(incident: VendorIncident, issues: Issue[]): { keys: string[]; strong: boolean } {
  const v = VENDORS[incident.vendor];
  const strongRe = words(v.words);
  // Only distinctive component names: a single generic word ("API", "Webhooks") would match everything.
  const comps = incident.components
    .map((c) => c.trim().toLowerCase())
    .filter((c) => c.length >= 6 && !GENERIC_COMPONENTS.has(c))
    .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const weakRe = comps.length ? words(comps) : null;
  const text = (i: Issue) => `${i.summary} ${(i.labels ?? []).join(' ')}`.toLowerCase();
  const strong = issues.filter((i) => isOpen(i) && strongRe.test(text(i)));
  const weak = weakRe ? issues.filter((i) => isOpen(i) && !strong.includes(i) && weakRe.test(text(i))) : [];
  const all = [...strong, ...weak].slice(0, MAX_AFFECTED);
  return { keys: all.map((i) => i.key), strong: strong.length > 0 };
}

const GENERIC_COMPONENTS = new Set(['api requests', 'webhooks', 'website', 'dashboard', 'notifications', 'support', 'billing', 'api']);

const minutesSince = (iso: string, now: Date) => Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 60_000));

/** Outside incidents that touch open work, as Heads-up alerts. Pure. */
export function outsideAlerts(incidents: VendorIncident[], issues: Issue[], now: Date, me: string): Alert[] {
  const out: Alert[] = [];
  for (const inc of incidents) {
    if (inc.impact === 'none') continue;
    const hit = affected(inc, issues);
    if (!hit.keys.length) continue;
    const v = VENDORS[inc.vendor];
    const list = hit.keys.join(', ');
    const link = inc.url ? ` Status: ${inc.url}` : '';
    const ops: Op[] = hit.keys.map((k) => ({
      type: 'comment',
      issueKey: k,
      body: `Heads-up: ${v.name} reports "${inc.name}" (${inc.impact} impact, ${inc.status}). This may affect this issue.${link} ${AUDIT(me)}`,
    }));
    out.push({
      id: `outside:${inc.vendor}:${inc.id}`,
      kind: 'outside',
      severity: inc.impact === 'minor' ? 'urgent' : 'critical',
      confidence: hit.strong ? 'confirmed' : 'keyword',
      issueKey: hit.keys[0],
      summary: inc.name,
      ageMinutes: minutesSince(inc.startedAt, now),
      rule: `${v.name} status page: "${inc.name}", ${inc.impact} impact, ${inc.status}; matched ${hit.strong ? `issues naming ${v.name}` : 'issues by keyword'}: ${list}`,
      evidence: hit.keys,
      facts: { vendor: v.name, impact: inc.impact, affected: list, url: inc.url ?? '' },
      action: {
        kind: 'note',
        say: {
          en: `add a note about the ${v.name} outage to ${list}`,
          fr: `ajoute une note sur la panne ${v.name} à ${list}`,
          ar: `أضيف ملاحظة عن عطل ${v.name} إلى ${list}`,
        } satisfies Record<Lang, string>,
        ops,
      },
    });
  }
  return out.sort((a, b) => (a.severity === 'critical' ? 0 : 1) - (b.severity === 'critical' ? 0 : 1) || a.ageMinutes - b.ageMinutes);
}

/** Parse one Statuspage /api/v2/incidents/unresolved.json body. Unknown shapes yield nothing. */
export function parseStatuspage(vendor: VendorId, body: unknown): VendorIncident[] {
  const list = (body as { incidents?: unknown[] } | null)?.incidents;
  if (!Array.isArray(list)) return [];
  const impacts = new Set(['none', 'minor', 'major', 'critical']);
  return list.flatMap((raw) => {
    const r = raw as Record<string, any>;
    if (typeof r?.id !== 'string' || typeof r?.name !== 'string') return [];
    const url = typeof r.shortlink === 'string' && /^https:\/\//.test(r.shortlink) ? r.shortlink : undefined;
    return [
      {
        vendor,
        id: r.id,
        name: r.name.slice(0, 160),
        impact: impacts.has(r.impact) ? r.impact : 'minor',
        status: typeof r.status === 'string' ? r.status : 'investigating',
        components: Array.isArray(r.components) ? r.components.map((c: any) => String(c?.name ?? '')).filter(Boolean).slice(0, 8) : [],
        url,
        startedAt: typeof r.started_at === 'string' ? r.started_at : typeof r.created_at === 'string' ? r.created_at : new Date(0).toISOString(),
      },
    ];
  });
}
