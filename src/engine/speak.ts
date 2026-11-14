// Speech helpers: word caps, list joining, the LLM guardrail, and trilingual phrases.
import type { Lang, StatusCategory } from './types';

export const MAX_SPOKEN_WORDS = 60;

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Cap speech at maxWords. Cuts at the last full sentence that fits;
 * if not even one sentence fits, hard-cuts the words and ends with an ellipsis.
 */
export function capWords(text: string, maxWords = MAX_SPOKEN_WORDS): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (wordCount(clean) <= maxWords) return clean;
  const sentences = clean.match(/[^.!?؟]+[.!?؟]+|[^.!?؟]+$/g) ?? [clean];
  let out = '';
  for (const s of sentences) {
    const next = (out + ' ' + s.trim()).trim();
    if (wordCount(next) > maxWords) break;
    out = next;
  }
  if (out) return out;
  return clean.split(' ').slice(0, maxWords).join(' ') + '…';
}

export function joinList(items: string[], lang: Lang): string {
  if (items.length <= 1) return items.join('');
  const and = lang === 'fr' ? ' et ' : lang === 'ar' ? ' و' : ' and ';
  return items.slice(0, -1).join(', ') + and + items[items.length - 1];
}

const ISSUE_KEY = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g;

/**
 * Guardrail for LLM phrasing: reject output that names an issue key the facts did not contain,
 * is empty, or runs over the word cap. Callers fall back to the template draft.
 */
export function guardPhrase(
  llmText: string | null | undefined,
  allowedKeys: Set<string>,
  maxWords = MAX_SPOKEN_WORDS,
  /** Keys the draft names: a rewording that drops one loses the evidence, so the template wins. */
  requiredKeys: Set<string> = new Set(),
): string | null {
  if (!llmText) return null;
  const text = llmText.replace(/\s+/g, ' ').trim();
  if (!text || wordCount(text) > maxWords) return null;
  const used = new Set(text.match(ISSUE_KEY) ?? []);
  for (const k of used) if (!allowedKeys.has(k)) return null;
  for (const k of requiredKeys) if (!used.has(k)) return null;
  return text;
}

export function extractKeys(text: string): Set<string> {
  return new Set(text.match(ISSUE_KEY) ?? []);
}

const statusName: Record<Lang, Record<StatusCategory | 'blocked', string>> = {
  en: { todo: 'To Do', inprogress: 'In Progress', done: 'Done', blocked: 'Blocked' },
  fr: { todo: 'À faire', inprogress: 'En cours', done: 'Terminé', blocked: 'Bloqué' },
  ar: { todo: 'قيد الانتظار', inprogress: 'قيد التنفيذ', done: 'منجز', blocked: 'محظور' },
};

export function statusLabel(lang: Lang, s: StatusCategory | 'blocked'): string {
  return statusName[lang][s];
}

const en = {
  changes: (n: number) => (n === 1 ? '1 change.' : `${n} changes.`),
  moveTo: (k: string, s: string) => `${k} to ${s}`,
  blockedOn: (k: string, reason: string) => `${k} to Blocked: ${reason}`,
  blockedBy: (k: string, b: string) => `${k} blocked by ${b}`,
  tell: (name: string) => `I'll tell ${name}`,
  assignedToYou: 'assigned to you',
  note: (k: string) => `note on ${k}`,
  plusStandup: 'Plus a standup note in Confluence.',
  askYes: 'Say yes to save.',
  saved: (n: number) => (n === 1 ? 'Done. 1 change saved.' : `Done. ${n} changes saved.`),
  savedPartial: (ok: number, failed: number) => `Saved ${ok}, ${failed} failed. Check the receipt.`,
  cancelled: 'Cancelled. Nothing was changed.',
  expired: 'That confirmation expired. Nothing was changed. Say it again.',
  nothingPending: 'There is nothing waiting for a yes.',
  unclear: (bits: string[]) => `I didn't catch: ${bits.join('; ')}.`,
  noChanges: "I didn't hear an issue key and a status. Try: I finished MP-12.",
  cannot: (k: string, why: string) => `Can't change ${k}: ${why}.`,
  alreadyThere: (k: string, s: string) => `${k} is already ${s}`,
  noRisks: 'No risks this week. Nice.',
  risksHeader: (n: number) => (n === 1 ? '1 risk this week.' : `${n} risks this week.`),
  confirmed: 'confirmed',
  estimate: "That's an estimate.",
  want: (fix: string) => `Want me to ${fix}?`,
  driveHeader: (min: number, things: number, decisions: number) =>
    `You have ${min} minutes: ${things} ${things === 1 ? 'thing' : 'things'}${decisions ? `, ${decisions} decision` : ''}.`,
  nothingToday: 'Nothing open is assigned to you.',
  teamOpen: (n: number) => `Your team has ${n} open ${n === 1 ? 'issue' : 'issues'}. Ask what's at risk.`,
  noIssuesVisible: 'I can’t see any open Jira issues. An admin can pick projects or load demo data in HeyBrief settings.',
  error: 'HeyBrief could not reach Jira just now. Nothing was changed. Try again in a moment.',
  slow: 'Jira is slow right now. If you just said yes, check the receipt before trying again.',
  tooManyWrites: 'That is a lot of changes this hour. I paused writes for safety. Try again later.',
  tooManyItems: (n: number) => `I can take up to ${n} issues at once. Say the first ${n}.`,
  empty: 'Say brief me, what is at risk, or a status update like: I finished MP-12.',
};

export type Phrases = typeof en;

const fr: Phrases = {
  changes: (n: number) => (n === 1 ? '1 changement.' : `${n} changements.`),
  moveTo: (k: string, s: string) => `${k} passe à ${s}`,
  blockedOn: (k: string, reason: string) => `${k} bloqué : ${reason}`,
  blockedBy: (k: string, b: string) => `${k} bloqué par ${b}`,
  tell: (name: string) => `je préviens ${name}`,
  assignedToYou: 'assigné à vous',
  note: (k: string) => `note sur ${k}`,
  plusStandup: 'Et une note de standup dans Confluence.',
  askYes: 'Dites oui pour enregistrer.',
  saved: (n: number) => (n === 1 ? 'C’est fait. 1 changement enregistré.' : `C’est fait. ${n} changements enregistrés.`),
  savedPartial: (ok: number, failed: number) => `${ok} enregistrés, ${failed} en échec. Voir le reçu.`,
  cancelled: 'Annulé. Rien n’a changé.',
  expired: 'La confirmation a expiré. Rien n’a changé. Répétez.',
  nothingPending: 'Rien n’attend de confirmation.',
  unclear: (bits: string[]) => `Je n’ai pas compris : ${bits.join(' ; ')}.`,
  noChanges: 'Je n’ai entendu ni ticket ni statut. Essayez : j’ai fini MP-12.',
  cannot: (k: string, why: string) => `Impossible de modifier ${k} : ${why}.`,
  alreadyThere: (k: string, s: string) => `${k} est déjà ${s}`,
  noRisks: 'Aucun risque cette semaine.',
  risksHeader: (n: number) => (n === 1 ? '1 risque cette semaine.' : `${n} risques cette semaine.`),
  confirmed: 'confirmé',
  estimate: 'C’est une estimation.',
  want: (fix: string) => `Voulez-vous que je ${fix} ?`,
  driveHeader: (min: number, things: number, decisions: number) =>
    `Vous avez ${min} minutes : ${things} ${things === 1 ? 'sujet' : 'sujets'}${decisions ? `, ${decisions} décision` : ''}.`,
  nothingToday: 'Rien d’ouvert ne vous est assigné.',
  teamOpen: (n: number) => `Votre équipe a ${n} ticket${n > 1 ? 's' : ''} ouvert${n > 1 ? 's' : ''}. Demandez les risques.`,
  noIssuesVisible: 'Je ne vois aucun ticket Jira ouvert. Un admin peut choisir les projets ou charger la démo dans les réglages HeyBrief.',
  error: 'HeyBrief n’a pas pu joindre Jira. Rien n’a changé. Réessayez dans un instant.',
  slow: 'Jira est lent. Si vous venez de dire oui, vérifiez le reçu avant de réessayer.',
  tooManyWrites: 'Beaucoup de changements cette heure-ci. Écritures en pause par sécurité. Réessayez plus tard.',
  tooManyItems: (n: number) => `Je peux traiter ${n} tickets à la fois. Donnez les ${n} premiers.`,
  empty: 'Dites : résumé, quels risques, ou une mise à jour comme : j’ai fini MP-12.',
};

const ar: Phrases = {
  changes: (n: number) => (n === 1 ? 'تغيير واحد.' : `${n} تغييرات.`),
  moveTo: (k: string, s: string) => `${k} إلى ${s}`,
  blockedOn: (k: string, reason: string) => `${k} محظور: ${reason}`,
  blockedBy: (k: string, b: string) => `${k} محظور بسبب ${b}`,
  tell: (name: string) => `سأُبلغ ${name}`,
  assignedToYou: 'مُسند إليك',
  note: (k: string) => `ملاحظة على ${k}`,
  plusStandup: 'وملاحظة الاجتماع اليومي في Confluence.',
  askYes: 'قل نعم للحفظ.',
  saved: (n: number) => (n === 1 ? 'تم. حُفظ تغيير واحد.' : `تم. حُفظت ${n} تغييرات.`),
  savedPartial: (ok: number, failed: number) => `حُفظ ${ok}، وفشل ${failed}. راجع الإيصال.`,
  cancelled: 'أُلغي. لم يتغير شيء.',
  expired: 'انتهت مهلة التأكيد. لم يتغير شيء. أعد المحاولة.',
  nothingPending: 'لا شيء بانتظار التأكيد.',
  unclear: (bits: string[]) => `لم أفهم: ${bits.join('؛ ')}.`,
  noChanges: 'لم أسمع رقم مهمة وحالة. جرّب: أنهيت MP-12.',
  cannot: (k: string, why: string) => `لا يمكن تعديل ${k}: ${why}.`,
  alreadyThere: (k: string, s: string) => `${k} بالفعل ${s}`,
  noRisks: 'لا مخاطر هذا الأسبوع.',
  risksHeader: (n: number) => (n === 1 ? 'خطر واحد هذا الأسبوع.' : `${n} مخاطر هذا الأسبوع.`),
  confirmed: 'مؤكد',
  estimate: 'هذا تقدير.',
  want: (fix: string) => `هل تريد أن ${fix}؟`,
  driveHeader: (min: number, things: number, decisions: number) =>
    `لديك ${min} دقيقة: ${things} مواضيع${decisions ? '، وقرار واحد' : ''}.`,
  nothingToday: 'لا مهام مفتوحة مسندة إليك.',
  teamOpen: (n: number) => `لدى فريقك ${n} مهام مفتوحة. اسأل عن المخاطر.`,
  noIssuesVisible: 'لا أرى أي مهام مفتوحة في Jira. يمكن للمسؤول اختيار المشاريع أو تحميل بيانات العرض من إعدادات HeyBrief.',
  error: 'تعذّر الوصول إلى Jira الآن. لم يتغير شيء. حاول بعد قليل.',
  slow: 'Jira بطيء الآن. إن قلت نعم للتو فراجع الإيصال قبل المحاولة مجددا.',
  tooManyWrites: 'تغييرات كثيرة في هذه الساعة. أوقفت الكتابة احتياطا. حاول لاحقا.',
  tooManyItems: (n: number) => `يمكنني معالجة ${n} مهام في المرة الواحدة. اذكر أول ${n}.`,
  empty: 'قل: ملخص، أو ما المخاطر، أو تحديثا مثل: أنهيت MP-12.',
};

export const T: Record<Lang, Phrases> = { en, fr, ar };
