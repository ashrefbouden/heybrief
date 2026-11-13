import { capWords, joinList, T } from '../speak';
import type { Lang } from '../types';
import type { Risk, Signal } from './radar';

function signalPhrase(s: Signal, lang: Lang, rootKey: string): string {
  const f = s.facts;
  const others = s.evidence.filter((k) => k !== rootKey);
  switch (lang) {
    case 'fr':
      switch (s.id) {
        case 'blocked-too-long':
          return `bloqué depuis ${f.days} jours`;
        case 'blocking-chain':
          return `bloque ${joinList(others, lang)}`;
        case 'overdue':
          return `en retard de ${f.daysOverdue} jours`;
        case 'due-soon-not-started':
          return `dû dans ${f.daysLeft} jours, pas commencé`;
        case 'owner-overload':
          return `une personne porte ${f.held} des ${f.open} tickets ouverts`;
        case 'stale':
          return `sans mise à jour depuis ${f.idleDays} jours`;
      }
      break;
    case 'ar':
      switch (s.id) {
        case 'blocked-too-long':
          return `محظور منذ ${f.days} أيام`;
        case 'blocking-chain':
          return `يعطّل ${joinList(others, lang)}`;
        case 'overdue':
          return `متأخر ${f.daysOverdue} أيام`;
        case 'due-soon-not-started':
          return `موعده بعد ${f.daysLeft} أيام ولم يبدأ`;
        case 'owner-overload':
          return `شخص واحد يحمل ${f.held} من ${f.open} مهام مفتوحة`;
        case 'stale':
          return `بلا تحديث منذ ${f.idleDays} أيام`;
      }
      break;
    default:
      switch (s.id) {
        case 'blocked-too-long':
          return `has been blocked ${f.days} days`;
        case 'blocking-chain':
          return `blocks ${joinList(others, lang)}`;
        case 'overdue':
          return `is ${f.daysOverdue} ${f.daysOverdue === 1 ? 'day' : 'days'} overdue`;
        case 'due-soon-not-started':
          return `is due in ${f.daysLeft} days and not started`;
        case 'owner-overload':
          return `belongs to someone holding ${f.held} of ${f.open} open issues`;
        case 'stale':
          return `has had no update for ${f.idleDays} days`;
      }
  }
  return s.rule;
}

/** Spoken radar: header, the top risk in full with its fix as a question, the rest by key. ≤ 60 words. */
export function speakRadar(risks: Risk[], lang: Lang): string {
  const t = T[lang];
  if (!risks.length) return t.noRisks;
  const top = risks[0];
  const highest = lang === 'fr' ? 'Le plus urgent' : lang === 'ar' ? 'الأعلى' : 'Highest';
  const facts = top.signals.map((s) => signalPhrase(s, lang, top.rootKey));
  const label = top.label === 'confirmed' ? `, ${t.confirmed}.` : `. ${t.estimate}`;
  const rest = risks.slice(1).map((r) => r.rootKey);
  const also = rest.length
    ? lang === 'fr'
      ? ` Aussi : ${joinList(rest, lang)}.`
      : lang === 'ar'
        ? ` أيضا: ${joinList(rest, lang)}.`
        : ` Also: ${joinList(rest, lang)}.`
    : '';
  const head = `${t.risksHeader(risks.length)} ${highest}: ${top.rootKey} ${joinList(facts, lang)}${label}${also}`;
  const ask = t.want(top.fix.say[lang]);
  return `${capWords(head, 60 - ask.split(' ').length)} ${ask}`;
}

/** The threshold behind each rule, in words, so "why?" names the rule without reading a log line. */
function ruleWords(s: Signal, lang: Lang): string {
  const r = {
    'blocked-too-long': { en: 'blocked 3 days or more', fr: 'bloqué 3 jours ou plus', ar: 'محظور 3 أيام أو أكثر' },
    'blocking-chain': { en: 'a blocker holding up open work', fr: 'un blocage qui retient du travail ouvert', ar: 'عائق يوقف عملا مفتوحا' },
    overdue: { en: 'past its due date', fr: 'échéance dépassée', ar: 'تجاوز موعده' },
    'due-soon-not-started': { en: 'due soon and not started', fr: 'échéance proche, pas commencé', ar: 'موعده قريب ولم يبدأ' },
    'owner-overload': { en: 'one person holding too much open work', fr: 'une personne surchargée', ar: 'شخص واحد يحمل عملا كثيرا' },
    stale: { en: 'in progress with no update for a week', fr: 'en cours sans mise à jour depuis une semaine', ar: 'قيد التنفيذ دون تحديث منذ أسبوع' },
  } as const;
  return r[s.id][lang];
}

/** Spoken answer to "why?": the facts, the rules that fired and the issues that prove them, nothing invented. */
export function explainRisk(risk: Risk, lang: Lang): string {
  const facts = joinList(
    risk.signals.map((s) => signalPhrase(s, lang, risk.rootKey)),
    lang,
  );
  const rules = joinList(
    risk.signals.map((s) => ruleWords(s, lang)),
    lang,
  );
  const confirmed = risk.label === 'confirmed';
  const sources = risk.sources.join(', ');
  if (lang === 'fr')
    return capWords(
      `${risk.rootKey} ${facts}. Règles déclenchées : ${rules}. ${confirmed ? 'Confirmé par Jira' : 'C’est une estimation'}. Preuves : ${sources}.`,
    );
  if (lang === 'ar')
    return capWords(
      `${risk.rootKey} ${facts}. القواعد: ${rules}. ${confirmed ? 'مؤكد من Jira' : 'هذا تقدير'}. الأدلة: ${sources}.`,
    );
  return capWords(
    `${risk.rootKey} ${facts}. Rules that fired: ${rules}. ${confirmed ? 'Confirmed from Jira' : 'That is an estimate'}. Evidence: ${sources}.`,
  );
}
