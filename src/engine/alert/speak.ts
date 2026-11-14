// Spoken heads-up: what happened, how long ago, how sure we are, and one action as a question.
import { capWords, T } from '../speak';
import type { Lang } from '../types';
import type { Alert } from './detect';

function ago(min: number, lang: Lang): string {
  const h = Math.floor(min / 60);
  const d = Math.floor(h / 24);
  if (lang === 'fr') {
    if (min < 2) return 'à l’instant';
    if (min < 60) return `il y a ${min} minutes`;
    if (h < 24) return h === 1 ? 'il y a une heure' : `il y a ${h} heures`;
    return d === 1 ? 'hier' : `il y a ${d} jours`;
  }
  if (lang === 'ar') {
    if (min < 2) return 'الآن';
    if (min < 60) return `منذ ${min} دقيقة`;
    if (h < 24) return h === 1 ? 'منذ ساعة' : `منذ ${h} ساعات`;
    return d === 1 ? 'أمس' : `منذ ${d} أيام`;
  }
  if (min < 2) return 'just now';
  if (min < 60) return `${min} minutes ago`;
  if (h < 24) return h === 1 ? 'an hour ago' : `${h} hours ago`;
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

const HEAD: Record<Lang, Record<Alert['kind'], string>> = {
  en: {
    incident: 'Urgent heads-up: possible incident.',
    security: 'Urgent heads-up: security issue.',
    'deadline-collision': 'Heads-up: a blocker will make a deadline slip.',
    'due-today': 'Heads-up: top-priority work due today, not started.',
    outside: 'Heads-up: an outside outage touches your work.',
  },
  fr: {
    incident: 'Alerte urgente : incident possible.',
    security: 'Alerte urgente : problème de sécurité.',
    'deadline-collision': 'Attention : un blocage va faire glisser une échéance.',
    'due-today': 'Attention : tâche prioritaire due aujourd’hui, pas commencée.',
    outside: 'Attention : une panne externe touche votre travail.',
  },
  ar: {
    incident: 'تنبيه عاجل: حادث محتمل.',
    security: 'تنبيه عاجل: مشكلة أمنية.',
    'deadline-collision': 'تنبيه: عائق سيؤخر موعدا نهائيا.',
    'due-today': 'تنبيه: مهمة ذات أولوية موعدها اليوم ولم تبدأ.',
    outside: 'تنبيه: عطل خارجي يمس عملك.',
  },
};

const INCIDENT_CONFIRMED: Record<Lang, string> = {
  en: 'Urgent heads-up: incident.',
  fr: 'Alerte urgente : incident.',
  ar: 'تنبيه عاجل: حادث.',
};

function detail(a: Alert, lang: Lang): string {
  const when = ago(a.ageMinutes, lang);
  const owner = String(a.facts.owner || '');
  if (a.kind === 'outside') {
    const v = String(a.facts.vendor);
    const imp = String(a.facts.impact);
    const affected = String(a.facts.affected);
    if (lang === 'fr') return `${v} signale : ${a.summary}, impact ${IMPACT.fr[imp] ?? imp}, ${when}. Concerne ${affected}.`;
    if (lang === 'ar') return `${v} يبلّغ: ${a.summary}، تأثير ${IMPACT.ar[imp] ?? imp}، ${when}. يمس ${affected}.`;
    return `${v} reports: ${a.summary}, ${imp} impact, ${when}. Affects ${affected}.`;
  }
  if (a.kind === 'deadline-collision') {
    const day =
      a.facts.daysLeft === 0
        ? { en: 'today', fr: 'aujourd’hui', ar: 'اليوم' }[lang]
        : { en: 'tomorrow', fr: 'demain', ar: 'غدا' }[lang];
    if (lang === 'fr') return `${a.issueKey} bloque ${a.facts.blocked}, dû ${day}.`;
    if (lang === 'ar') return `${a.issueKey} يعطّل ${a.facts.blocked} المستحق ${day}.`;
    return `${a.issueKey} blocks ${a.facts.blocked}, due ${day}.`;
  }
  if (lang === 'fr') return `${a.issueKey}, ${a.summary}, ouvert ${when}, ${owner ? `assigné à ${owner}` : 'personne dessus'}.`;
  if (lang === 'ar') return `${a.issueKey}، ${a.summary}، فُتح ${when}، ${owner ? `مسند إلى ${owner}` : 'دون مسؤول'}.`;
  return `${a.issueKey}, ${a.summary}, opened ${when}, ${owner ? `with ${owner}` : 'nobody on it'}.`;
}

const IMPACT: Record<'fr' | 'ar', Record<string, string>> = {
  fr: { minor: 'mineur', major: 'majeur', critical: 'critique' },
  ar: { minor: 'طفيف', major: 'كبير', critical: 'حرج' },
};

function sureness(a: Alert, lang: Lang): string {
  if (a.kind === 'outside') {
    const v = String(a.facts.vendor);
    if (a.confidence === 'confirmed')
      return { en: `From ${v}'s status page.`, fr: `Source : la page de statut ${v}.`, ar: `المصدر: صفحة حالة ${v}.` }[lang];
    return {
      en: `From ${v}'s status page; the link to your issues is by keyword, so verify.`,
      fr: `Source : la page de statut ${v} ; le lien avec vos tickets vient de mots-clés, vérifiez.`,
      ar: `المصدر: صفحة حالة ${v}؛ الربط بمهامك بالكلمات فقط، يرجى التحقق.`,
    }[lang];
  }
  if (a.confidence === 'confirmed') return { en: 'Confirmed from Jira.', fr: 'Confirmé par Jira.', ar: 'مؤكد من Jira.' }[lang];
  return {
    en: 'Only keywords suggest this, so please verify.',
    fr: 'Seuls des mots-clés l’indiquent, vérifiez.',
    ar: 'استنتاج من الكلمات فقط، يرجى التحقق.',
  }[lang];
}

/** The interruption. ≤ 60 words; the action question is never cut. */
export function speakAlert(a: Alert, lang: Lang, more = 0): string {
  const ask = T[lang].want(a.action.say[lang]);
  const tail =
    more > 0
      ? { en: ` ${more} more after this.`, fr: ` Et ${more} autre${more > 1 ? 's' : ''} ensuite.`, ar: ` و${more} بعده.` }[lang]
      : '';
  // "possible incident" followed by "confirmed from Jira" contradicts itself: only keyword matches stay "possible".
  const head = a.kind === 'incident' && a.confidence === 'confirmed' ? INCIDENT_CONFIRMED[lang] : HEAD[lang][a.kind];
  const body = `${head} ${detail(a, lang)} ${sureness(a, lang)}${tail}`;
  return `${capWords(body, 60 - ask.split(' ').length)} ${ask}`;
}

/** "Why?" after an alert: the rule and the evidence, nothing invented. */
export function explainAlert(a: Alert, lang: Lang): string {
  const src = lang === 'fr' ? 'Sources' : lang === 'ar' ? 'المصادر' : 'Sources';
  const conf =
    a.confidence === 'confirmed'
      ? T[lang].confirmed
      : lang === 'fr'
        ? 'mots-clés seulement'
        : lang === 'ar'
          ? 'كلمات مفتاحية فقط'
          : 'keywords only';
  return capWords(`${a.issueKey}: ${a.rule} (${conf}). ${src}: ${a.evidence.join(', ')}.`);
}

export const NO_ALERTS: Record<Lang, string> = {
  en: 'No urgent alerts right now.',
  fr: 'Aucune alerte urgente pour l’instant.',
  ar: 'لا تنبيهات عاجلة الآن.',
};

export const SNOOZED: Record<Lang, (min: number) => string> = {
  en: (m) => `Okay, I'll remind you in ${m} minutes. Nothing was changed.`,
  fr: (m) => `D’accord, je vous le rappelle dans ${m} minutes. Rien n’a changé.`,
  ar: (m) => `حسنا، سأذكّرك بعد ${m} دقيقة. لم يتغير شيء.`,
};
