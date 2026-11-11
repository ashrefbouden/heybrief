// Every visible string on the voice page, in English, French and Arabic. Arabic flips the page right-to-left.
import type { Lang } from './types';

export interface Strings {
  tagline: string;
  langLabel: string;
  timeLabel: string;
  timeStandard: string;
  timeDrive: (m: number) => string;
  voiceOn: string;
  voiceOff: string;
  demoReset: string;
  demoIncident: string;
  demoResetDone: string;
  demoIncidentDone: string;
  demoOutage: string;
  demoOutageDone: string;
  // states
  ready: string;
  listening: string;
  thinking: string;
  speaking: string;
  // input
  placeholderMic: string;
  placeholderType: string;
  send: string;
  talk: string;
  stopSend: string;
  hintMic: string;
  hintNoMic: string;
  // conversation
  conversation: string;
  hello: string;
  you: string;
  // gate
  gateTitle: string;
  gateNote: string;
  yes: string;
  no: string;
  yesWord: string;
  expiresIn: (mmss: string) => string;
  expired: string;
  expiredMsg: string;
  failed: string;
  // heads-up
  headsUp: string;
  critical: string;
  // pulse
  pulse: string;
  pulseNote: string;
  statBlocked: string;
  statLate: string;
  statMine: string;
  statDone: string;
  stuck: string;
  nothingBlocked: string;
  blockedCount: (n: number) => string;
  unblockedBy: string;
  holdingUp: (n: number) => string;
  late: string;
  pastDue: (n: number) => string;
  plate: string;
  openCount: (n: number) => string;
  plateEmpty: string;
  load: string;
  overloaded: string;
  unassigned: string;
  done: string;
  due: (d: string) => string;
  boardEmpty: string;
  firstRunTitle: string;
  firstRunBody: string;
  firstRunKey: string;
  firstRunLoad: string;
  firstRunWorking: string;
  firstRunDone: (risk: string, talk: string) => string;
  boardError: string;
  // receipt
  receipt: string;
  receiptNote: string;
  receiptEmpty: string;
  youSaid: string;
  proposed: string;
  measured: (changes: number, fromSentence: boolean, planS?: string, writeS?: string) => string;
  undo: string;
  undone: string;
  undoOk: string;
  undoFail: string;
  kind: Record<'talkback' | 'risk-fix' | 'alert', string>;
  // voice + mic
  speakingWith: (lang: string, voice: string) => string;
  noSynth: string;
  noVoice: (lang: string) => string;
  mic: Record<'not_granted' | 'unavailable' | 'rate_limited' | 'dismissed' | 'other', string>;
  chips: Array<{ label: string; text: string }>;
}

const en: Strings = {
  tagline: 'Talk to Jira, and Jira changes.',
  langLabel: 'Language',
  timeLabel: 'Time you have',
  timeStandard: 'Standard brief',
  timeDrive: (m) => `${m}-minute brief`,
  voiceOn: 'Voice on',
  voiceOff: 'Voice off',
  demoReset: 'Reset demo',
  demoIncident: 'Simulate P1 outage',
  demoResetDone: 'Demo reset. Same story, fresh board.',
  demoIncidentDone: 'Someone just opened a Highest-priority incident in Jira.',
  demoOutage: 'Simulate GitHub outage',
  demoOutageDone: 'GitHub’s status page now reports an outage.',
  ready: 'Ready',
  listening: 'Listening…',
  thinking: 'Working…',
  speaking: 'Speaking…',
  placeholderMic: 'Tap the mic and talk, or type here',
  placeholderType: 'Type what you would say',
  send: 'Send',
  talk: 'Talk',
  stopSend: 'Stop and send',
  hintMic: 'Tap the mic, talk, then pause. HeyBrief sends when you stop.',
  hintNoMic: 'Voice input is not available in this browser. Typing works the same way.',
  conversation: 'Conversation',
  hello: 'Hi. Ask for your brief, ask what is at risk, or just tell me what you did. I only change Jira after you say yes.',
  you: 'You',
  gateTitle: 'Waiting for your yes',
  gateNote: 'Nothing changes until you say yes. Anything else cancels.',
  yes: 'Yes, do it',
  no: 'Cancel',
  yesWord: 'Yes',
  expiresIn: (t) => `Expires in ${t}`,
  expired: 'Expired',
  expiredMsg: 'The proposal expired. Nothing was changed.',
  failed: 'Something went wrong. Nothing was changed.',
  headsUp: 'Heads-up',
  critical: 'Critical',
  pulse: 'Team pulse',
  pulseNote: 'Live from Jira',
  statBlocked: 'Blocked',
  statLate: 'Late',
  statMine: 'On you',
  statDone: 'Done, 7 days',
  stuck: 'Stuck',
  nothingBlocked: 'Nothing blocked',
  blockedCount: (n) => `${n} blocked`,
  unblockedBy: 'Waiting on',
  holdingUp: (n) => `Holding up ${n}`,
  late: 'Late',
  pastDue: (n) => `${n} past due`,
  plate: 'Your plate',
  openCount: (n) => `${n} open`,
  plateEmpty: 'Nothing open on you.',
  load: 'Team load',
  overloaded: 'overloaded',
  unassigned: 'Unassigned',
  done: 'Done this week',
  due: (d) => `due ${d}`,
  boardEmpty: 'No project to show yet. Ask a Jira admin to load HeyBrief demo data, or to pick projects in HeyBrief settings.',
  firstRunTitle: 'Try HeyBrief in two minutes',
  firstRunBody: 'Load a demo story into an empty test project: 14 issues, three real risks, one teammate overloaded. Nothing outside that project is touched.',
  firstRunKey: 'Empty project key',
  firstRunLoad: 'Load demo data',
  firstRunWorking: 'Creating the demo issues, about 20 seconds…',
  firstRunDone: (r, t) => `Demo loaded. Now say “${r}”, then “${t}”.`,
  boardError: 'Could not load the project. Answers still work.',
  receipt: 'Receipt',
  receiptNote: 'Every approved change, with undo',
  receiptEmpty: 'Every change you approve shows up here, with what you said and an undo button.',
  youSaid: 'You said',
  proposed: 'HeyBrief proposed',
  measured: (n, s, p, w) =>
    [`${n} ${n === 1 ? 'change' : 'changes'}${s ? ' from 1 sentence' : ''}`, p && `understood in ${p} s`, w && `saved in ${w} s`]
      .filter(Boolean)
      .join(' · '),
  undo: 'Undo',
  undone: 'Undone',
  undoOk: 'Undone. Jira is back to how it was.',
  undoFail: 'Some changes could not be undone. Check the issues.',
  kind: { talkback: 'Status update', 'risk-fix': 'Risk fix', alert: 'Heads-up' },
  speakingWith: (l, v) => `${l} voice: ${v}`,
  noSynth: 'This browser cannot speak answers. They are shown as text.',
  noVoice: (l) => `No ${l} voice on this device, so answers are text only.`,
  mic: {
    not_granted: 'Microphone is off for this page. You can keep typing.',
    unavailable: 'Voice input is not available here. You can keep typing.',
    rate_limited: 'Voice input is busy. Try again in a moment.',
    dismissed: 'No problem. Tap the mic again when you are ready.',
    other: 'The microphone stopped. Try again, or type.',
  },
  chips: [
    { label: 'Brief me', text: 'Brief me' },
    { label: 'What’s at risk?', text: 'What’s at risk this week?' },
    { label: 'Why?', text: 'Why?' },
    { label: 'Anything urgent?', text: 'Anything urgent?' },
  ],
};

const fr: Strings = {
  tagline: 'Parlez à Jira, et Jira change.',
  langLabel: 'Langue',
  timeLabel: 'Temps disponible',
  timeStandard: 'Résumé standard',
  timeDrive: (m) => `Résumé en ${m} min`,
  voiceOn: 'Voix activée',
  voiceOff: 'Voix coupée',
  demoReset: 'Réinitialiser la démo',
  demoIncident: 'Simuler une panne P1',
  demoResetDone: 'Démo réinitialisée. Même histoire, tableau neuf.',
  demoIncidentDone: 'Quelqu’un vient d’ouvrir un incident de priorité maximale.',
  demoOutage: 'Simuler une panne GitHub',
  demoOutageDone: 'La page de statut GitHub signale une panne.',
  ready: 'Prêt',
  listening: 'J’écoute…',
  thinking: 'Je travaille…',
  speaking: 'Je parle…',
  placeholderMic: 'Touchez le micro et parlez, ou écrivez ici',
  placeholderType: 'Écrivez ce que vous diriez',
  send: 'Envoyer',
  talk: 'Parler',
  stopSend: 'Arrêter et envoyer',
  hintMic: 'Touchez le micro, parlez, puis marquez une pause. HeyBrief envoie quand vous vous arrêtez.',
  hintNoMic: 'La saisie vocale n’est pas disponible dans ce navigateur. L’écrit fonctionne pareil.',
  conversation: 'Conversation',
  hello: 'Bonjour. Demandez votre résumé, les risques, ou dites-moi ce que vous avez fait. Je ne change Jira qu’après votre oui.',
  you: 'Vous',
  gateTitle: 'En attente de votre oui',
  gateNote: 'Rien ne change avant votre oui. Toute autre réponse annule.',
  yes: 'Oui, vas-y',
  no: 'Annuler',
  yesWord: 'Oui',
  expiresIn: (t) => `Expire dans ${t}`,
  expired: 'Expiré',
  expiredMsg: 'La proposition a expiré. Rien n’a changé.',
  failed: 'Un problème est survenu. Rien n’a changé.',
  headsUp: 'Alerte',
  critical: 'Critique',
  pulse: 'Pouls de l’équipe',
  pulseNote: 'En direct de Jira',
  statBlocked: 'Bloqués',
  statLate: 'En retard',
  statMine: 'Pour vous',
  statDone: 'Terminés, 7 j',
  stuck: 'Bloqué',
  nothingBlocked: 'Rien de bloqué',
  blockedCount: (n) => `${n} bloqué${n > 1 ? 's' : ''}`,
  unblockedBy: 'En attente de',
  holdingUp: (n) => `Retient ${n}`,
  late: 'En retard',
  pastDue: (n) => `${n} en retard`,
  plate: 'Votre assiette',
  openCount: (n) => `${n} ouvert${n > 1 ? 's' : ''}`,
  plateEmpty: 'Rien d’ouvert pour vous.',
  load: 'Charge de l’équipe',
  overloaded: 'surchargé',
  unassigned: 'Non assigné',
  done: 'Terminé cette semaine',
  due: (d) => `échéance ${d}`,
  boardEmpty: 'Aucun projet à afficher. Demandez à un admin Jira de charger la démo HeyBrief ou de choisir des projets dans les réglages.',
  firstRunTitle: 'Essayez HeyBrief en deux minutes',
  firstRunBody: 'Chargez une histoire de démo dans un projet de test vide : 14 tickets, trois vrais risques, un coéquipier surchargé. Rien d’autre n’est modifié.',
  firstRunKey: 'Clé d’un projet vide',
  firstRunLoad: 'Charger la démo',
  firstRunWorking: 'Création des tickets de démo, environ 20 secondes…',
  firstRunDone: (r, t) => `Démo chargée. Dites « ${r} », puis « ${t} ».`,
  boardError: 'Impossible de charger le projet. Les réponses fonctionnent toujours.',
  receipt: 'Reçu',
  receiptNote: 'Chaque changement approuvé, avec annulation',
  receiptEmpty: 'Chaque changement que vous approuvez apparaît ici, avec ce que vous avez dit et un bouton Annuler.',
  youSaid: 'Vous avez dit',
  proposed: 'HeyBrief a proposé',
  measured: (n, s, p, w) =>
    [`${n} changement${n > 1 ? 's' : ''}${s ? ' en 1 phrase' : ''}`, p && `compris en ${p} s`, w && `enregistré en ${w} s`]
      .filter(Boolean)
      .join(' · '),
  undo: 'Annuler',
  undone: 'Annulé',
  undoOk: 'Annulé. Jira est revenu à l’état d’avant.',
  undoFail: 'Certains changements n’ont pas pu être annulés. Vérifiez les tickets.',
  kind: { talkback: 'Mise à jour', 'risk-fix': 'Correctif de risque', alert: 'Alerte' },
  speakingWith: (l, v) => `Voix ${l} : ${v}`,
  noSynth: 'Ce navigateur ne peut pas lire les réponses. Elles s’affichent en texte.',
  noVoice: (l) => `Aucune voix ${l} sur cet appareil, les réponses sont en texte.`,
  mic: {
    not_granted: 'Le micro est désactivé pour cette page. Vous pouvez écrire.',
    unavailable: 'La saisie vocale n’est pas disponible ici. Vous pouvez écrire.',
    rate_limited: 'La saisie vocale est occupée. Réessayez dans un instant.',
    dismissed: 'Pas de souci. Touchez le micro quand vous êtes prêt.',
    other: 'Le micro s’est arrêté. Réessayez, ou écrivez.',
  },
  chips: [
    { label: 'Mon résumé', text: 'Mon résumé du jour' },
    { label: 'Quels risques ?', text: 'Quels sont les risques cette semaine ?' },
    { label: 'Pourquoi ?', text: 'Pourquoi ?' },
    { label: 'Quelque chose d’urgent ?', text: 'Quelque chose d’urgent ?' },
  ],
};

const ar: Strings = {
  tagline: 'تحدّث إلى Jira، فيتغيّر Jira.',
  langLabel: 'اللغة',
  timeLabel: 'الوقت المتاح',
  timeStandard: 'ملخص عادي',
  timeDrive: (m) => `ملخص ${m} دقيقة`,
  voiceOn: 'الصوت مفعّل',
  voiceOff: 'الصوت متوقف',
  demoReset: 'إعادة العرض',
  demoIncident: 'محاكاة عطل P1',
  demoResetDone: 'أُعيد العرض. القصة نفسها، لوحة جديدة.',
  demoIncidentDone: 'فتح أحدهم للتو حادثة بأعلى أولوية في Jira.',
  demoOutage: 'محاكاة عطل GitHub',
  demoOutageDone: 'صفحة حالة GitHub تبلّغ الآن عن عطل.',
  ready: 'جاهز',
  listening: 'أستمع…',
  thinking: 'أعمل…',
  speaking: 'أتحدث…',
  placeholderMic: 'اضغط على الميكروفون وتكلم، أو اكتب هنا',
  placeholderType: 'اكتب ما ستقوله',
  send: 'إرسال',
  talk: 'تحدّث',
  stopSend: 'توقف وأرسل',
  hintMic: 'اضغط على الميكروفون، تكلم، ثم توقف قليلا. يرسل HeyBrief عندما تتوقف.',
  hintNoMic: 'الإدخال الصوتي غير متاح في هذا المتصفح. الكتابة تعمل بالطريقة نفسها.',
  conversation: 'المحادثة',
  hello: 'مرحبا. اطلب ملخصك، أو اسأل عن المخاطر، أو أخبرني بما أنجزت. لا أغيّر Jira إلا بعد أن تقول نعم.',
  you: 'أنت',
  gateTitle: 'بانتظار موافقتك',
  gateNote: 'لا يتغير شيء قبل أن تقول نعم. أي رد آخر يلغي.',
  yes: 'نعم، نفّذ',
  no: 'إلغاء',
  yesWord: 'نعم',
  expiresIn: (t) => `ينتهي خلال ${t}`,
  expired: 'انتهى',
  expiredMsg: 'انتهت مهلة الاقتراح. لم يتغير شيء.',
  failed: 'حدث خطأ. لم يتغير شيء.',
  headsUp: 'تنبيه',
  critical: 'حرج',
  pulse: 'نبض الفريق',
  pulseNote: 'مباشرة من Jira',
  statBlocked: 'محظورة',
  statLate: 'متأخرة',
  statMine: 'لديك',
  statDone: 'منجزة، 7 أيام',
  stuck: 'عالقة',
  nothingBlocked: 'لا شيء محظور',
  blockedCount: (n) => `${n} محظورة`,
  unblockedBy: 'بانتظار',
  holdingUp: (n) => `تعطّل ${n}`,
  late: 'متأخرة',
  pastDue: (n) => `${n} تجاوزت الموعد`,
  plate: 'مهامك',
  openCount: (n) => `${n} مفتوحة`,
  plateEmpty: 'لا مهام مفتوحة لديك.',
  load: 'حمل الفريق',
  overloaded: 'مثقل',
  unassigned: 'غير مُسندة',
  done: 'أُنجزت هذا الأسبوع',
  due: (d) => `الموعد ${d}`,
  boardEmpty: 'لا مشروع للعرض بعد. اطلب من مسؤول Jira تحميل بيانات عرض HeyBrief أو اختيار المشاريع في الإعدادات.',
  firstRunTitle: 'جرّب HeyBrief في دقيقتين',
  firstRunBody: 'حمّل قصة عرض في مشروع اختبار فارغ: 14 مهمة وثلاثة مخاطر حقيقية وزميل مثقل. لا يُمس شيء خارج ذلك المشروع.',
  firstRunKey: 'مفتاح مشروع فارغ',
  firstRunLoad: 'تحميل بيانات العرض',
  firstRunWorking: 'جارٍ إنشاء مهام العرض، نحو 20 ثانية…',
  firstRunDone: (r, t) => `حُمّل العرض. قل «${r}» ثم «${t}».`,
  boardError: 'تعذّر تحميل المشروع. الإجابات ما زالت تعمل.',
  receipt: 'الإيصال',
  receiptNote: 'كل تغيير وافقت عليه، مع التراجع',
  receiptEmpty: 'كل تغيير توافق عليه يظهر هنا، مع ما قلته وزر للتراجع.',
  youSaid: 'قلتَ',
  proposed: 'اقترح HeyBrief',
  measured: (n, s, p, w) =>
    [`${n} تغييرات${s ? ' من جملة واحدة' : ''}`, p && `فُهمت في ${p} ث`, w && `حُفظت في ${w} ث`].filter(Boolean).join(' · '),
  undo: 'تراجع',
  undone: 'تم التراجع',
  undoOk: 'تم التراجع. عاد Jira كما كان.',
  undoFail: 'تعذّر التراجع عن بعض التغييرات. راجع المهام.',
  kind: { talkback: 'تحديث حالة', 'risk-fix': 'معالجة خطر', alert: 'تنبيه' },
  speakingWith: (l, v) => `صوت ${l}: ${v}`,
  noSynth: 'هذا المتصفح لا يستطيع قراءة الإجابات. تظهر نصا.',
  noVoice: (l) => `لا يوجد صوت ${l} على هذا الجهاز، لذا تظهر الإجابات نصا.`,
  mic: {
    not_granted: 'الميكروفون متوقف لهذه الصفحة. يمكنك الكتابة.',
    unavailable: 'الإدخال الصوتي غير متاح هنا. يمكنك الكتابة.',
    rate_limited: 'الإدخال الصوتي مشغول. حاول بعد لحظة.',
    dismissed: 'لا بأس. اضغط على الميكروفون عندما تكون جاهزا.',
    other: 'توقف الميكروفون. حاول مجددا أو اكتب.',
  },
  chips: [
    { label: 'ملخصي', text: 'ملخصي اليوم' },
    { label: 'ما المخاطر؟', text: 'ما هي المخاطر هذا الأسبوع؟' },
    { label: 'لماذا؟', text: 'لماذا؟' },
    { label: 'هل من شيء عاجل؟', text: 'هل من شيء عاجل؟' },
  ],
};

export const S: Record<Lang, Strings> = { en, fr, ar };
