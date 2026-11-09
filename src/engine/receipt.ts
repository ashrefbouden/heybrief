// Plain-language lines for the drive receipt gadget.
import type { OpResult, Receipt } from './types';

export interface ReceiptLine {
  text: string;
  ok: boolean;
  issueKey?: string;
  undoable: boolean;
}

export function describeResult(r: OpResult): ReceiptLine | undefined {
  const op = r.op;
  const fail = r.ok ? '' : ` (failed: ${r.error ?? 'unknown error'})`;
  const note = r.ok && r.error ? ` (${r.error})` : '';
  switch (op.type) {
    case 'transition':
      return {
        text: `${op.issueKey} moved to ${op.preferStatus ?? op.toCategory}${note}${fail}`,
        ok: r.ok,
        issueKey: op.issueKey,
        undoable: !!r.undo,
      };
    case 'flag':
      return {
        text: `${op.issueKey} ${op.flagged ? 'flagged' : 'unflagged'}${fail}`,
        ok: r.ok,
        issueKey: op.issueKey,
        undoable: !!r.undo,
      };
    case 'assign':
      return { text: `${op.issueKey} reassigned${fail}`, ok: r.ok, issueKey: op.issueKey, undoable: !!r.undo };
    case 'link-blocks':
      return { text: `${op.blockerKey} now blocks ${op.blockedKey}${fail}`, ok: r.ok, issueKey: op.blockedKey, undoable: false };
    case 'notify':
      return { text: `Owner notified about ${op.issueKey}${fail}`, ok: r.ok, issueKey: op.issueKey, undoable: false };
    case 'create-issue':
      return {
        text: `Created ${r.createdKey ?? 'a follow-up'}: ${op.summary}${fail}`,
        ok: r.ok,
        issueKey: r.createdKey,
        undoable: false,
      };
    case 'standup-page':
      return { text: `Standup note added in Confluence (${op.lines.length} lines)${fail}`, ok: r.ok, undoable: false };
    case 'comment':
      // Audit comments are implied by every change; only show them when they are the change.
      return { text: `Comment on ${op.issueKey}${fail}`, ok: r.ok, issueKey: op.issueKey, undoable: false };
  }
}

export interface ReceiptView {
  id: string;
  at: string;
  kind: Receipt['kind'];
  heard: string;
  lines: ReceiptLine[];
  allOk: boolean;
  canUndo: boolean;
  undone: boolean;
}

/** Collapse a receipt into what a person wants to see: one line per real change, audit comments hidden. */
export function viewReceipt(r: Receipt, undone = false): ReceiptView {
  const keysWithOtherChanges = new Set(
    r.results.filter((x) => x.op.type !== 'comment' && 'issueKey' in x.op).map((x) => (x.op as { issueKey: string }).issueKey),
  );
  const lines = r.results
    .filter((x) => !(x.op.type === 'comment' && x.ok && keysWithOtherChanges.has(x.op.issueKey)))
    .map(describeResult)
    .filter((l): l is ReceiptLine => !!l);
  return {
    id: r.id,
    at: r.at,
    kind: r.kind,
    heard: r.heard,
    lines,
    allOk: r.results.every((x) => x.ok),
    canUndo: !undone && r.results.some((x) => x.ok && x.undo),
    undone,
  };
}
