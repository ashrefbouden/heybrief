// Plain-language lines for proposals (the yes card) and receipts, in English, French and Arabic.
import type { Lang, Op, OpResult, Receipt } from './types';

export interface ReceiptLine {
  text: string;
  ok: boolean;
  issueKey?: string;
  undoable: boolean;
}

type Words = {
  moved: (k: string, s: string) => string;
  flagged: (k: string) => string;
  unflagged: (k: string) => string;
  assigned: (k: string) => string;
  links: (a: string, b: string) => string;
  unlinked: (a: string, b: string) => string;
  notified: (k: string) => string;
  created: (k: string, s: string) => string;
  createFollowUp: (s: string) => string;
  deleted: (k: string) => string;
  standup: (n: number) => string;
  comment: (k: string) => string;
  failed: (why: string) => string;
};

const W: Record<Lang, Words> = {
  en: {
    moved: (k, s) => `${k} moved to ${s}`,
    flagged: (k) => `${k} flagged`,
    unflagged: (k) => `${k} unflagged`,
    assigned: (k) => `${k} assigned to you`,
    links: (a, b) => `${a} now blocks ${b}`,
    unlinked: (a, b) => `${a} no longer blocks ${b}`,
    notified: (k) => `Owner notified about ${k}`,
    created: (k, s) => `Created ${k}: ${s}`,
    createFollowUp: (s) => `New follow-up: ${s}`,
    deleted: (k) => `${k} removed`,
    standup: (n) => `Standup note added in Confluence (${n} ${n === 1 ? 'line' : 'lines'})`,
    comment: (k) => `Comment on ${k}`,
    failed: (why) => `failed: ${why}`,
  },
  fr: {
    moved: (k, s) => `${k} passe à ${s}`,
    flagged: (k) => `${k} signalé comme bloqué`,
    unflagged: (k) => `${k} signalement retiré`,
    assigned: (k) => `${k} vous est assigné`,
    links: (a, b) => `${a} bloque maintenant ${b}`,
    unlinked: (a, b) => `${a} ne bloque plus ${b}`,
    notified: (k) => `Responsable prévenu pour ${k}`,
    created: (k, s) => `${k} créé : ${s}`,
    createFollowUp: (s) => `Nouveau suivi : ${s}`,
    deleted: (k) => `${k} supprimé`,
    standup: (n) => `Note de standup dans Confluence (${n} ${n === 1 ? 'ligne' : 'lignes'})`,
    comment: (k) => `Commentaire sur ${k}`,
    failed: (why) => `échec : ${why}`,
  },
  ar: {
    moved: (k, s) => `${k} نُقل إلى ${s}`,
    flagged: (k) => `${k} عُلّم كمحظور`,
    unflagged: (k) => `${k} أزيلت العلامة`,
    assigned: (k) => `${k} أُسند إليك`,
    links: (a, b) => `${a} يحظر الآن ${b}`,
    unlinked: (a, b) => `${a} لم يعد يحظر ${b}`,
    notified: (k) => `أُبلغ المسؤول عن ${k}`,
    created: (k, s) => `أُنشئت ${k}: ${s}`,
    createFollowUp: (s) => `متابعة جديدة: ${s}`,
    deleted: (k) => `حُذفت ${k}`,
    standup: (n) => `ملاحظة الاجتماع اليومي في Confluence (${n} أسطر)`,
    comment: (k) => `تعليق على ${k}`,
    failed: (why) => `فشل: ${why}`,
  },
};

const STATUS: Record<Lang, Record<string, string>> = {
  en: {},
  fr: { 'to do': 'À faire', 'in progress': 'En cours', done: 'Terminé', blocked: 'Bloqué', todo: 'À faire', inprogress: 'En cours' },
  ar: {
    'to do': 'قيد الانتظار',
    'in progress': 'قيد التنفيذ',
    done: 'منجز',
    blocked: 'محظور',
    todo: 'قيد الانتظار',
    inprogress: 'قيد التنفيذ',
  },
};
const EN_CATEGORY: Record<string, string> = { todo: 'To Do', inprogress: 'In Progress', done: 'Done' };

function statusName(name: string, lang: Lang): string {
  return STATUS[lang][name.toLowerCase()] ?? EN_CATEGORY[name] ?? name;
}

/** One line for one op. `createdKey` is known only after the write. */
export function describeOp(op: Op, lang: Lang = 'en', createdKey?: string): string {
  const w = W[lang];
  switch (op.type) {
    case 'transition':
      return w.moved(op.issueKey, statusName(op.preferStatus ?? op.toCategory, lang));
    case 'flag':
      return op.flagged ? w.flagged(op.issueKey) : w.unflagged(op.issueKey);
    case 'assign':
      return w.assigned(op.issueKey);
    case 'link-blocks':
      return w.links(op.blockerKey, op.blockedKey);
    case 'unlink-blocks':
      return w.unlinked(op.blockerKey, op.blockedKey);
    case 'notify':
      return w.notified(op.issueKey);
    case 'create-issue':
      return createdKey ? w.created(createdKey, op.summary) : w.createFollowUp(op.summary);
    case 'delete-issue':
      return w.deleted(op.issueKey);
    case 'standup-page':
      return w.standup(op.lines.length);
    case 'comment':
      return w.comment(op.issueKey);
  }
}

/** Audit comments ride along with every change; only list them when the comment is the change. */
function hideAuditComments<T>(items: T[], opOf: (x: T) => Op, keep: (x: T) => boolean = () => true): T[] {
  const changed = new Set(
    items
      .map(opOf)
      .filter((o) => o.type !== 'comment' && 'issueKey' in o)
      .map((o) => (o as { issueKey: string }).issueKey),
  );
  for (const o of items.map(opOf)) if (o.type === 'link-blocks') changed.add(o.blockedKey);
  return items.filter((x) => {
    const o = opOf(x);
    return !(o.type === 'comment' && keep(x) && changed.has(o.issueKey));
  });
}

/** What the yes card lists: one line per real change, in the speaker's language. */
export function proposalLines(ops: Op[], lang: Lang = 'en'): string[] {
  return hideAuditComments(ops, (o) => o).map((o) => describeOp(o, lang));
}

export function describeResult(r: OpResult, lang: Lang = 'en'): ReceiptLine {
  const op = r.op;
  const w = W[lang];
  let text = describeOp(op, lang, r.createdKey);
  if (!r.ok) text += ` (${w.failed(r.error ?? 'unknown error')})`;
  else if (r.error) text += ` (${r.error})`;
  const issueKey =
    op.type === 'create-issue'
      ? r.createdKey
      : op.type === 'link-blocks' || op.type === 'unlink-blocks'
        ? op.blockedKey
        : 'issueKey' in op
          ? op.issueKey
          : undefined;
  return { text, ok: r.ok, issueKey, undoable: !!r.undo };
}

export interface ReceiptView {
  id: string;
  at: string;
  kind: Receipt['kind'];
  heard: string;
  /** What HeyBrief proposed and the person approved. */
  readback?: string;
  lines: ReceiptLine[];
  allOk: boolean;
  canUndo: boolean;
  undone: boolean;
}

/** Collapse a receipt into what a person wants to see: one line per real change, audit comments hidden. */
export function viewReceipt(r: Receipt, undone = false, lang: Lang = 'en'): ReceiptView {
  const lines = hideAuditComments(
    r.results,
    (x) => x.op,
    (x) => x.ok,
  ).map((x) => describeResult(x, lang));
  return {
    id: r.id,
    at: r.at,
    kind: r.kind,
    heard: r.heard,
    readback: r.readback,
    lines,
    allOk: r.results.every((x) => x.ok),
    canUndo: !undone && r.results.some((x) => x.ok && x.undo),
    undone,
  };
}
