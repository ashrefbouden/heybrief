// Use cases shared by every door (Siri web trigger, Rovo actions, MCP tools, gadget).
// Doors stay thin: they authenticate, call one of these, and format the reply.

import { DEFAULT_ALERTS, detectAlerts, type Alert, type AlertConfig } from './alert/detect';
import { explainAlert, NO_ALERTS, SNOOZED, speakAlert } from './alert/speak';
import { driveBrief } from './brief/drive';
import { proposalLines } from './receipt';
import { outsideAlerts, type OutsideConfig, type VendorIncident } from './outside/incidents';
import { classifyReply, getPending, propose, resolvePending } from './confirm';
import { detectLang } from './lang';
import type { Deps } from './ports';
import { DEFAULT_RADAR, runRadar, type RadarConfig, type Risk } from './risk/radar';
import { explainRisk, speakRadar } from './risk/speak';
import { normaliseKeys, parseUpdate } from './talkback/parse';
import { extractKeys, guardPhrase, T } from './speak';
import { planTalkback } from './talkback/plan';
import type { Lang, Scope } from './types';
import { words } from './words';

export interface Answer {
  speech: string;
  lang: Lang;
  /** True when HeyBrief asked a question and the Siri Shortcut should listen again. */
  expectReply: boolean;
  /** Present when a write is waiting for a yes. Rovo/MCP must pass it back to confirm. */
  pendingId?: string;
  /** The writes waiting for a yes, one plain line each, in `lang`. Shown on the yes card. */
  changes?: string[];
  data?: unknown;
}

const RADAR_TTL = 15 * 60;
const OUTSIDE_TTL = 120;
const radarKey = (accountId: string) => `radar:${accountId}`;

/** An alert interrupts once; after that it stays quiet for a week (or until a snooze runs out). */
const ALERT_SEEN_TTL = 7 * 24 * 3600;
export const ALERT_SNOOZE_MINUTES = 30;
/** Cap on stored-flag lookups per poll, so a noisy project cannot make the poll slow. */
const MAX_ALERTS_CHECKED = 5;
const alertSeenKey = (accountId: string, alertId: string) => `alert-seen:${accountId}:${alertId}`;
const alertLastKey = (accountId: string) => `alert-last:${accountId}`;

export class HeyBrief {
  constructor(
    private deps: Deps,
    private opts: {
      projectKeys?: string[];
      radar?: RadarConfig;
      alerts?: AlertConfig;
      standupPage?: boolean;
      outside?: OutsideConfig;
    } = {},
  ) {}

  async talkback(accountId: string, text: string, langHint?: string): Promise<Answer> {
    const parsed = parseUpdate(text, { lang: langHint, projectKeys: this.opts.projectKeys });
    const plan = await planTalkback(parsed, { jira: this.deps.jira, accountId, standupPage: this.opts.standupPage });
    if (!plan.changeCount) return { speech: plan.readback, lang: parsed.lang, expectReply: false };
    const pending = await propose(this.deps, {
      accountId,
      kind: 'talkback',
      ops: plan.ops,
      heard: text,
      readback: plan.readback,
    });
    return {
      speech: plan.readback,
      lang: parsed.lang,
      expectReply: true,
      pendingId: pending.id,
      changes: proposalLines(plan.ops, parsed.lang),
      data: { changes: plan.changeCount, problems: plan.problems, ops: plan.ops },
    };
  }

  async confirm(accountId: string, reply: string, pendingId?: string, langHint?: string): Promise<Answer> {
    const lang = detectLang(reply, langHint);
    const out = await resolvePending(this.deps, { accountId, reply, lang, pendingId });
    return {
      speech: out.speech,
      lang,
      expectReply: false,
      data: { status: out.status, receipt: 'receipt' in out ? out.receipt : undefined },
    };
  }

  async radar(accountId: string, scope: Scope, langHint?: string, text = ''): Promise<Answer> {
    const lang = detectLang(text, langHint);
    const issues = await this.deps.jira.searchOpen(scope);
    const risks = runRadar(issues, this.deps.clock.now(), accountId, this.opts.radar ?? DEFAULT_RADAR);
    await this.deps.store.set(radarKey(accountId), risks, RADAR_TTL);
    const speech = speakRadar(risks, lang);
    if (!risks.length) return { speech, lang, expectReply: false, data: { risks } };
    const pending = await this.proposeFix(accountId, risks[0], speech, text);
    return {
      speech,
      lang,
      expectReply: true,
      pendingId: pending.id,
      changes: proposalLines(pending.ops, lang),
      data: { risks: risks.map(riskJson) },
    };
  }

  /** Desk gadget: run and cache the radar WITHOUT proposing a fix (must not clobber a pending Siri write). */
  async scanRisks(accountId: string, scope: Scope): Promise<ReturnType<typeof riskJson>[]> {
    const issues = await this.deps.jira.searchOpen(scope);
    const risks = runRadar(issues, this.deps.clock.now(), accountId, this.opts.radar ?? DEFAULT_RADAR);
    await this.deps.store.set(radarKey(accountId), risks, RADAR_TTL);
    return risks.map(riskJson);
  }

  /**
   * Desk gadget: propose the fix for risk n from the last radar run. The gadget then shows the
   * read-back and a Confirm button, which calls confirm() with the pending id. Two human clicks.
   */
  async proposeRiskFix(accountId: string, n = 1, lang: Lang = 'en'): Promise<Answer> {
    const risks = await this.deps.store.get<Risk[]>(radarKey(accountId));
    const risk = risks?.[n - 1];
    if (!risk) {
      const speech = lang === 'fr' ? 'Lancez d’abord le radar.' : lang === 'ar' ? 'شغّل رادار المخاطر أولا.' : 'Run Risk Radar first.';
      return { speech, lang, expectReply: false };
    }
    const speech = `${risk.rootKey}: ${T[lang].want(risk.fix.say[lang])}`;
    const pending = await this.proposeFix(accountId, risk, speech);
    return { speech, lang, expectReply: true, pendingId: pending.id, changes: proposalLines(pending.ops, lang), data: riskJson(risk) };
  }

  /** "Why?" about the last radar run: risk n (1-based) or the top one. */
  async why(accountId: string, n = 1, langHint?: string, text = ''): Promise<Answer> {
    const lang = detectLang(text, langHint);
    const pendingAlert = await getPending(this.deps, accountId);
    if (pendingAlert?.kind === 'alert') {
      const last = await this.deps.store.get<Alert[]>(alertLastKey(accountId));
      if (last?.[0])
        return {
          speech: explainAlert(last[0], lang),
          lang,
          expectReply: true,
          pendingId: pendingAlert.id,
          changes: proposalLines(pendingAlert.ops, lang),
          data: alertJson(last[0]),
        };
    }
    const risks = await this.deps.store.get<Risk[]>(radarKey(accountId));
    const risk = risks?.[n - 1];
    if (!risk) {
      const speech =
        lang === 'fr' ? 'Demandez d’abord les risques.' : lang === 'ar' ? 'اسأل عن المخاطر أولا.' : 'Ask me for risks first.';
      return { speech, lang, expectReply: false };
    }
    // Keep the pending fix alive: the user may say yes after hearing why.
    const pending = await getPending(this.deps, accountId);
    return {
      speech: explainRisk(risk, lang),
      lang,
      expectReply: !!pending,
      pendingId: pending?.id,
      changes: pending ? proposalLines(pending.ops, lang) : undefined,
      data: riskJson(risk),
    };
  }

  async brief(
    accountId: string,
    opts: { etaMinutes?: number; lang?: string; text?: string; scope?: Scope } = {},
  ): Promise<Answer> {
    const lang = detectLang(opts.text ?? '', opts.lang);
    const scope: Scope = opts.scope ?? { kind: 'me', accountId };
    const issues = await this.deps.jira.searchOpen(scope);
    const now = this.deps.clock.now();
    const risks = runRadar(issues, now, accountId, this.opts.radar ?? DEFAULT_RADAR);
    await this.deps.store.set(radarKey(accountId), risks, RADAR_TTL);
    const b = driveBrief({ issues, risks, accountId, now, lang, etaMinutes: opts.etaMinutes });
    const speech = await this.phrase(b, lang);
    if (!b.decision) return { speech, lang, expectReply: false, data: { keys: b.keys, phrased: speech !== b.speech } };
    const pending = await this.proposeFix(accountId, b.decision, speech, opts.text);
    return {
      speech,
      lang,
      expectReply: true,
      pendingId: pending.id,
      changes: proposalLines(pending.ops, lang),
      data: { keys: b.keys, decision: riskJson(b.decision) },
    };
  }

  /**
   * Heads-up: the most urgent NEW alert, spoken once, with its playbook action waiting for a yes.
   * The voice page polls this. It stays silent (speech '') when there is nothing new, and it never
   * interrupts while another change is waiting for a yes, so it cannot replace what the user is confirming.
   * `ask: true` is the user asking "anything urgent?": then already-announced alerts are repeated.
   */
  async alerts(accountId: string, opts: { lang?: string; text?: string; scope?: Scope; ask?: boolean } = {}): Promise<Answer> {
    const lang = detectLang(opts.text ?? '', opts.lang);
    const quiet: Answer = { speech: '', lang, expectReply: false, data: { alert: null } };
    if (!opts.ask && (await getPending(this.deps, accountId))) return quiet;

    const issues = await this.deps.jira.searchOpen(opts.scope ?? { kind: 'me', accountId });
    const now = this.deps.clock.now();
    const jira = detectAlerts(issues, now, accountId, this.opts.alerts ?? DEFAULT_ALERTS);
    // Jira's own alerts come first; outside outages only fill in when they touch open work.
    const outside = outsideAlerts(await this.outsideIncidents(), issues, now, accountId);
    const all = [...jira, ...outside].slice(0, MAX_ALERTS_CHECKED);
    if (!all.length) return opts.ask ? { ...quiet, speech: NO_ALERTS[lang] } : quiet;

    let top: Alert | undefined;
    let more = 0;
    for (const a of all) {
      const key = alertSeenKey(accountId, a.id);
      if (!top) {
        // Atomic claim: two open tabs polling at once announce the alert once.
        const fresh = await this.deps.store.setIfAbsent(key, now.toISOString(), ALERT_SEEN_TTL);
        if (fresh || opts.ask) top = a;
      } else if ((await this.deps.store.get(key)) === undefined) more++;
    }
    if (!top) return quiet;

    const speech = speakAlert(top, lang, more);
    await this.deps.store.set(alertLastKey(accountId), [top], RADAR_TTL);
    const pending = await propose(this.deps, {
      accountId,
      kind: 'alert',
      ops: top.action.ops,
      heard: opts.text?.trim() || speech,
      readback: speech,
    });
    return {
      speech,
      lang,
      expectReply: true,
      pendingId: pending.id,
      changes: proposalLines(pending.ops, lang),
      data: { alert: alertJson(top), more },
    };
  }

  /**
   * Unresolved vendor incidents, when an admin turned Outside incidents on. Cached for everyone for
   * two minutes so a page of pollers makes one request per vendor. A failure is silence, never an error.
   */
  private async outsideIncidents(): Promise<VendorIncident[]> {
    const cfg = this.opts.outside;
    if (!cfg?.enabled || !cfg.vendors.length || !this.deps.status) return [];
    const key = `outside:${[...cfg.vendors].sort().join(',')}`;
    const cached = await this.deps.store.get<VendorIncident[]>(key);
    if (cached) return cached;
    try {
      const list = await this.deps.status.unresolved(cfg.vendors);
      await this.deps.store.set(key, list, OUTSIDE_TTL);
      return list;
    } catch {
      return [];
    }
  }

  /** "Later": cancel the alert's proposed action and bring the alert back after the snooze. */
  async snoozeAlert(accountId: string, langHint?: string, text = ''): Promise<Answer> {
    const lang = detectLang(text, langHint);
    const last = (await this.deps.store.get<Alert[]>(alertLastKey(accountId)))?.[0];
    await this.deps.store.delete(`pending:${accountId}`);
    if (last) {
      const key = alertSeenKey(accountId, last.id);
      await this.deps.store.delete(key);
      await this.deps.store.set(key, this.deps.clock.now().toISOString(), ALERT_SNOOZE_MINUTES * 60);
    }
    return { speech: SNOOZED[lang](ALERT_SNOOZE_MINUTES), lang, expectReply: false };
  }

  /**
   * Forge LLM rewords the brief's lead so it sounds natural. Rules and facts stay in code: the guard
   * drops any reply that names an issue key not in the facts, runs long, or comes late, and the
   * template is spoken instead. The question that asks for a yes is never reworded.
   */
  private async phrase(b: { speech: string; lead?: string; ask?: string; facts?: string }, lang: Lang): Promise<string> {
    if (!this.deps.phraser || !b.lead || !b.facts) return b.speech;
    const askWords = b.ask ? b.ask.split(/\s+/).length : 0;
    try {
      const out = await this.deps.phraser.phrase({ facts: b.facts, draft: b.lead, lang, maxWords: 60 - askWords });
      const safe = guardPhrase(out, extractKeys(b.facts + ' ' + b.lead), 60 - askWords);
      return safe ? `${safe} ${b.ask ?? ''}`.trim() : b.speech;
    } catch {
      return b.speech;
    }
  }

  /** `heard` is what the person said, shown on the receipt; falls back to the read-back for button-driven proposals. */
  private proposeFix(accountId: string, risk: Risk, speech: string, heard?: string) {
    return propose(this.deps, {
      accountId,
      kind: 'risk-fix',
      ops: risk.fix.ops,
      heard: heard?.trim() || speech,
      readback: speech,
    });
  }

  /**
   * Single entry point for free speech (Siri). A clear yes/no resolves the pending action;
   * any other sentence cancels it and is routed as a new request.
   */
  async route(accountId: string, text: string, opts: { lang?: string; etaMinutes?: number } = {}): Promise<Answer> {
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, 1000);
    if (!clean) {
      const lang = detectLang('', opts.lang);
      return { speech: T[lang].empty, lang, expectReply: false };
    }
    const pending = await getPending(this.deps, accountId);
    if (pending) {
      if (pending.kind === 'alert' && LATER.test(clean)) return this.snoozeAlert(accountId, opts.lang, clean);
      const r = classifyReply(clean);
      if (r !== 'other') return this.confirm(accountId, clean, undefined, opts.lang);
      // "why?" keeps the proposed fix alive; any other new request cancels it.
      if (WHY.test(clean)) return this.why(accountId, 1, opts.lang, clean);
      await this.deps.store.delete(`pending:${accountId}`);
    }
    if (WHY.test(clean)) return this.why(accountId, 1, opts.lang, clean);
    const keyed = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/.test(normaliseKeys(clean, this.opts.projectKeys));
    if (!keyed && URGENT.test(clean)) return this.alerts(accountId, { lang: opts.lang, text: clean, ask: true });
    if (RISK.test(clean)) return this.radar(accountId, { kind: 'me', accountId }, opts.lang, clean);
    const hasKey = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/.test(normaliseKeys(clean, this.opts.projectKeys));
    if (hasKey && !BRIEF.test(clean)) return this.talkback(accountId, clean, opts.lang);
    return this.brief(accountId, { etaMinutes: opts.etaMinutes, lang: opts.lang, text: clean });
  }

  /**
   * Run any use case with a deadline and spoken errors, so a door never returns silence or a stack trace.
   * On timeout the work may still finish in the background; confirmations are single-use, so a retried
   * yes cannot double-write, and the slow message points the user at the receipt.
   */
  async safely(lang: Lang, fn: () => Promise<Answer>, deadlineMs = 20_000): Promise<Answer & { failed?: 'timeout' | 'error' }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), deadlineMs);
    });
    try {
      const out = await Promise.race([fn(), timeout]);
      if (out === 'timeout') return { speech: T[lang].slow, lang, expectReply: false, failed: 'timeout' };
      return out;
    } catch {
      return { speech: T[lang].error, lang, expectReply: false, failed: 'error' };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

const WHY = words(['why', 'how come', 'pourquoi', 'لماذا', 'ليش', 'علاش']);
const RISK = words(['risks?', 'at risk', 'risques?', 'en danger', 'مخاطر', 'خطر', 'المخاطر']);
const URGENT = words([
  'urgent',
  'alerts?',
  'emergenc(?:y|ies)',
  'anything on fire',
  'urgences?',
  'alertes?',
  'عاجل',
  'طوارئ',
  'تنبيه(?:ات)?',
]);
const LATER = words([
  'later',
  'snooze',
  'remind me later',
  'not now',
  'plus tard',
  'pas maintenant',
  'لاحقا',
  'لاحقاً',
  'بعدين',
  'ليس الآن',
]);
const BRIEF = words(['brief(?: me)?', 'my day', 'my plate', 'résumé', 'ma journée', 'ملخص', 'يومي']);

function riskJson(r: Risk) {
  return {
    key: r.rootKey,
    summary: r.summary,
    score: r.score,
    label: r.label,
    signals: r.signals.map((s) => ({ id: s.id, rule: s.rule, label: s.label, evidence: s.evidence })),
    sources: r.sources,
    proposed_fix: { kind: r.fix.kind, say: r.fix.say.en, say_by_lang: r.fix.say },
  };
}

function alertJson(a: Alert) {
  return {
    id: a.id,
    kind: a.kind,
    severity: a.severity,
    confidence: a.confidence,
    key: a.issueKey,
    summary: a.summary,
    age_minutes: a.ageMinutes,
    rule: a.rule,
    sources: a.evidence,
    proposed_action: { kind: a.action.kind, say: a.action.say.en },
  };
}

/** What a UI banner needs from an alerts() answer: the issue and how loud to be. */
export function alertBanner(data: unknown): { key: string; severity: 'critical' | 'urgent' } | undefined {
  const a = (data as { alert?: { key?: unknown; severity?: unknown } | null } | undefined)?.alert;
  if (!a || typeof a.key !== 'string') return undefined;
  return { key: a.key, severity: a.severity === 'critical' ? 'critical' : 'urgent' };
}

export { riskJson as riskToJson, alertJson as alertToJson };
