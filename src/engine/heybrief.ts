// Use cases shared by every door (Siri web trigger, Rovo actions, MCP tools, gadget).
// Doors stay thin: they authenticate, call one of these, and format the reply.

import { driveBrief } from './brief/drive';
import { classifyReply, getPending, propose, resolvePending } from './confirm';
import { detectLang } from './lang';
import type { Deps } from './ports';
import { DEFAULT_RADAR, runRadar, type RadarConfig, type Risk } from './risk/radar';
import { explainRisk, speakRadar } from './risk/speak';
import { normaliseKeys, parseUpdate } from './talkback/parse';
import { T } from './speak';
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
  data?: unknown;
}

const RADAR_TTL = 15 * 60;
const radarKey = (accountId: string) => `radar:${accountId}`;

export class HeyBrief {
  constructor(
    private deps: Deps,
    private opts: { projectKeys?: string[]; radar?: RadarConfig; standupPage?: boolean } = {},
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
    const pending = await this.proposeFix(accountId, risks[0], speech);
    return { speech, lang, expectReply: true, pendingId: pending.id, data: { risks: risks.map(riskJson) } };
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
  async proposeRiskFix(accountId: string, n = 1): Promise<Answer> {
    const risks = await this.deps.store.get<Risk[]>(radarKey(accountId));
    const risk = risks?.[n - 1];
    if (!risk) return { speech: 'Run Risk Radar first.', lang: 'en', expectReply: false };
    const speech = `${risk.rootKey}: ${T.en.want(risk.fix.say.en)}`;
    const pending = await this.proposeFix(accountId, risk, speech);
    return { speech, lang: 'en', expectReply: true, pendingId: pending.id, data: riskJson(risk) };
  }

  /** "Why?" about the last radar run: risk n (1-based) or the top one. */
  async why(accountId: string, n = 1, langHint?: string, text = ''): Promise<Answer> {
    const lang = detectLang(text, langHint);
    const risks = await this.deps.store.get<Risk[]>(radarKey(accountId));
    const risk = risks?.[n - 1];
    if (!risk) {
      const speech =
        lang === 'fr' ? 'Demandez d’abord les risques.' : lang === 'ar' ? 'اسأل عن المخاطر أولا.' : 'Ask me for risks first.';
      return { speech, lang, expectReply: false };
    }
    // Keep the pending fix alive: the user may say yes after hearing why.
    const pending = await getPending(this.deps, accountId);
    return { speech: explainRisk(risk, lang), lang, expectReply: !!pending, pendingId: pending?.id, data: riskJson(risk) };
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
    if (!b.decision) return { speech: b.speech, lang, expectReply: false, data: { keys: b.keys } };
    const pending = await this.proposeFix(accountId, b.decision, b.speech);
    return {
      speech: b.speech,
      lang,
      expectReply: true,
      pendingId: pending.id,
      data: { keys: b.keys, decision: riskJson(b.decision) },
    };
  }

  private proposeFix(accountId: string, risk: Risk, speech: string) {
    return propose(this.deps, { accountId, kind: 'risk-fix', ops: risk.fix.ops, heard: speech, readback: speech });
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
      const r = classifyReply(clean);
      if (r !== 'other') return this.confirm(accountId, clean, undefined, opts.lang);
      // "why?" keeps the proposed fix alive; any other new request cancels it.
      if (WHY.test(clean)) return this.why(accountId, 1, opts.lang, clean);
      await this.deps.store.delete(`pending:${accountId}`);
    }
    if (WHY.test(clean)) return this.why(accountId, 1, opts.lang, clean);
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
const BRIEF = words(['brief(?: me)?', 'my day', 'my plate', 'résumé', 'ma journée', 'ملخص', 'يومي']);

function riskJson(r: Risk) {
  return {
    key: r.rootKey,
    summary: r.summary,
    score: r.score,
    label: r.label,
    signals: r.signals.map((s) => ({ id: s.id, rule: s.rule, label: s.label, evidence: s.evidence })),
    sources: r.sources,
    proposed_fix: { kind: r.fix.kind, say: r.fix.say.en },
  };
}

export { riskJson as riskToJson };
