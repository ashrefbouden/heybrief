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

/** Spoken answer to "why?": the issues and the rule that fired, nothing invented. */
export function explainRisk(risk: Risk, lang: Lang): string {
  const lead =
    lang === 'fr'
      ? `${risk.rootKey}, score ${risk.score}.`
      : lang === 'ar'
        ? `${risk.rootKey}، الدرجة ${risk.score}.`
        : `${risk.rootKey}, score ${risk.score}.`;
  const rules = risk.signals.map(
    (s) =>
      `${s.rule} (${s.label === 'confirmed' ? T[lang].confirmed : lang === 'fr' ? 'estimé' : lang === 'ar' ? 'تقدير' : 'estimated'})`,
  );
  const src = lang === 'fr' ? 'Sources' : lang === 'ar' ? 'المصادر' : 'Sources';
  return capWords(`${lead} ${rules.join('; ')}. ${src}: ${risk.sources.join(', ')}.`);
}
