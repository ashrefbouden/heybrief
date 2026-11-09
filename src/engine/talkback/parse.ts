// Talk-back parser: free-form spoken status update -> per-issue intents.
// Deterministic on purpose: the LLM never decides what gets written to Jira.
//
// "I finished MP-12, MP-15 is blocked on legal, I'll pick up MP-9 today"
//   -> [done MP-12] [blocked MP-15 reason "legal"] [start MP-9]

import { detectLang } from '../lang';
import type { Lang } from '../types';
import { startsWithWord, words } from '../words';

export type Intent = 'done' | 'start' | 'blocked' | 'unblock' | 'comment';

export interface ParsedItem {
  key: string;
  intent: Intent;
  /** Free-text blocker reason ("legal") or comment body. */
  text?: string;
  /** Issue key that blocks this one, when the reason names one ("blocked by MP-7"). */
  blockedBy?: string;
  raw: string;
}

export interface ParsedUpdate {
  lang: Lang;
  items: ParsedItem[];
  /** Clauses that named an issue but no clear intent, or were negated. Never written. */
  unclear: string[];
}

// Speech-to-text gives "MP 12", "mp-12", "MP12". Normalised to "MP-12".
const KEY_RE = /\b([A-Za-z][A-Za-z0-9]{1,9}?)[\s-]?(\d{1,6})\b/g; // lazy prefix: "MP12" -> MP + 12

const SPLIT_RE = /\s*(?:[,;.!?،؛؟\n]+|\s+(?:and then|then|and|also|et puis|puis|et|ensuite|ثم|وأيضا)\s+|\s+و(?=\s*[A-Za-z]))\s*/i;

const AR = (w: string) => `(?:و|ف)?${w}`; // Arabic: allow attached "and"/"so" prefixes

const NEG_RE = words([
  'not',
  "isn't",
  'isnt',
  "aren't",
  "wasn't",
  "haven't",
  "hasn't",
  "didn't",
  'never',
  'pas',
  'jamais',
  AR('لم'),
  AR('ليس'),
  AR('لن'),
  AR('ما'),
]);

// Order matters: unblock before blocked ("unblocked" contains "blocked").
const PATTERNS: Array<{ intent: Intent; re: RegExp }> = [
  {
    intent: 'unblock',
    re: words([
      'unblocked',
      'no longer blocked',
      'not blocked anymore',
      'débloquée?',
      'plus bloquée?',
      'لم يعد محظورا?',
      'تم فك الحظر',
      'لم يعد متوقفا?',
    ]),
  },
  {
    intent: 'blocked',
    re: words([
      'blocked',
      'stuck',
      'waiting (?:on|for)',
      'on hold',
      'bloquée?',
      'coincée?',
      'en attente',
      ...['محظور', 'متوقف', 'عالق', 'معلق', 'بانتظار', 'ينتظر'].map(AR),
    ]),
  },
  {
    intent: 'done',
    re: words([
      'finished',
      'finish',
      'done',
      'completed?',
      'closed?',
      'shipped',
      'merged',
      'wrapped up',
      'resolved',
      'terminée?',
      'finie?',
      'fait',
      'clôturée?',
      'livrée?',
      'résolue?',
      ...['أنهيت', 'انتهيت', 'خلصت', 'أكملت', 'اكتمل', 'منتهي', 'أنجزت', 'منجز'].map(AR),
    ]),
  },
  {
    intent: 'start',
    re: words([
      'start(?:ed|ing|s)?',
      'pick(?:ed|ing)? up',
      'began',
      'working on',
      'work on',
      'begin(?:ning)?',
      'take',
      'taking',
      'commencer?',
      'commence',
      'je prends',
      'prendre',
      'attaquer?',
      'travailler sur',
      'bosser sur',
      ...['سأبدأ', 'أبدأ', 'بدأت', 'سأعمل على', 'أعمل على', 'سآخذ', 'سأتولى'].map(AR),
    ]),
  },
  {
    intent: 'comment',
    re: words(['note', 'comment', 'remark', 'fyi', 'remarque', 'commentaire', AR('ملاحظة'), AR('تعليق')]),
  },
];

const REASON_RE =
  /(?:blocked|stuck|waiting|on hold|bloquée?|coincée?|en attente)\s+(?:on|by|for|because of|because|due to|par|sur|à cause de|de|du|des)?\s*(.+)$|(?:محظور|متوقف|عالق|معلق|بانتظار|ينتظر)\s*(?:بسبب|على|من)?\s*(.+)$/i;

const COMMENT_RE =
  /(?:note|comment|remark|fyi|remarque|commentaire|ملاحظة|تعليق)\s*(?:on|for|sur|pour|على)?\s*(?:[A-Z][A-Z0-9]{1,9}-\d+)?\s*[:,-]?\s*(.+)$/i;

export function normaliseKeys(text: string, projectKeys?: string[]): string {
  const allowed = projectKeys?.map((p) => p.toUpperCase());
  return text.replace(KEY_RE, (m, p: string, n: string) => {
    const proj = p.toUpperCase();
    if (allowed && !allowed.includes(proj)) return m;
    if (!allowed && !/^[A-Z][A-Z0-9]+$/.test(p)) return m; // lowercase words like "in 3" are not keys
    return `${proj}-${n}`;
  });
}

function keysIn(text: string): string[] {
  return [...new Set(text.match(/\b[A-Z][A-Z0-9]{1,9}-\d+\b/g) ?? [])];
}

const FILLER = new Set(['too', 'also', 'as', 'well', 'aussi', 'également', 'pareil', 'كذلك', 'أيضا', 'أيضاً']);

const LEADING_NOTE = startsWithWord(['note', 'comment', 'remark', 'fyi', 'remarque', 'commentaire', 'ملاحظة', 'تعليق']);

function detectIntent(clause: string): Intent | undefined {
  // "note on MP-12: waiting for review" is a note, even though it says "waiting for".
  if (LEADING_NOTE.test(clause)) return 'comment';
  for (const p of PATTERNS) if (p.re.test(clause)) return p.intent;
  return undefined;
}

function cleanReason(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const r = s
    .replace(/\b(today|tomorrow|now|aujourd'hui|aujourd’hui|demain)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return r || undefined;
}

/**
 * Parse a spoken update. projectKeys (if known) restricts what counts as an issue key,
 * so "PR 2" or "Q4 3" in speech are not mistaken for issues.
 */
export function parseUpdate(input: string, opts: { lang?: string; projectKeys?: string[] } = {}): ParsedUpdate {
  const lang = detectLang(input, opts.lang);
  const text = normaliseKeys(input, opts.projectKeys);

  // 1. split into clauses; 2. a clause with no issue key belongs to the previous clause
  //    ("blocked on legal and finance" stays one clause).
  //    The split keeps delimiters (capture group) so a merged clause keeps its "and".
  const parts = text.split(new RegExp(`(${SPLIT_RE.source})`, 'i'));
  const clauses: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const seg = parts[i]?.trim();
    if (!seg) continue;
    const delim = i > 0 ? (parts[i - 1] ?? ' ') : ' ';
    if (keysIn(seg).length === 0 && clauses.length > 0) {
      clauses[clauses.length - 1] += (/[,;.!?،؛؟\n]/.test(delim) ? ', ' : ' ' + delim.trim() + ' ') + seg;
    } else clauses.push(seg);
  }

  const items: ParsedItem[] = [];
  const unclear: string[] = [];
  let prevIntent: Intent | undefined;

  for (const clause of clauses) {
    const keys = keysIn(clause);
    if (keys.length === 0) continue; // chatter before the first key ("ok so")
    let intent = detectIntent(clause);

    // A negated done/start ("MP-3 is not finished") is never turned into a write.
    if (intent && intent !== 'unblock' && intent !== 'blocked' && intent !== 'comment' && NEG_RE.test(clause)) {
      unclear.push(clause);
      prevIntent = undefined;
      continue;
    }
    // "I finished MP-12 and MP-13": a bare second key inherits the intent. Only bare keys
    // ("MP-13", "MP-13 too"): an unknown verb ("then reviewed MP-9") must not inherit "done".
    const rest = clause
      .replace(/\b[A-Z][A-Z0-9]{1,9}-\d+\b/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (
      !intent &&
      prevIntent &&
      prevIntent !== 'blocked' &&
      prevIntent !== 'comment' &&
      rest.every((w) => FILLER.has(w.toLowerCase()))
    )
      intent = prevIntent;
    if (!intent) {
      unclear.push(clause);
      continue;
    }

    if (intent === 'blocked') {
      const m = clause.match(REASON_RE);
      const reasonRaw = cleanReason(m?.[1] ?? m?.[2]);
      // The subject is the first key; a key inside the reason is the blocker.
      const subject = keys[0];
      const blocker = reasonRaw ? keysIn(reasonRaw).find((k) => k !== subject) : undefined;
      items.push({ key: subject, intent, text: reasonRaw, blockedBy: blocker, raw: clause });
    } else if (intent === 'comment') {
      const m = clause.match(COMMENT_RE);
      items.push({ key: keys[0], intent, text: m?.[1]?.trim() || clause, raw: clause });
    } else {
      for (const k of keys) items.push({ key: k, intent, raw: clause });
    }
    prevIntent = intent;
  }

  return { lang, items: dedupe(items), unclear };
}

/** If the same issue is mentioned twice, the last statement wins ("start MP-3... actually MP-3 is done"). */
function dedupe(items: ParsedItem[]): ParsedItem[] {
  const last = new Map<string, ParsedItem>();
  for (const it of items) {
    if (it.intent === 'comment' && last.has(it.key)) continue; // a note never overrides a status change
    last.set(it.key, it);
  }
  return [...last.values()];
}
