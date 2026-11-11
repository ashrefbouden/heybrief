// Contract between the voice console UI and whatever runs the engine:
// the in-browser prototype (LocalBackend over fakes) or the Forge page (resolvers via @forge/bridge).

import type { ReceiptView } from '../../engine/receipt';
import type { Lang } from '../../engine/types';

export interface Turn {
  speech: string;
  lang: Lang;
  /** Present when a write is waiting for a yes. */
  pendingId?: string;
  /** One line per write waiting for the yes. */
  changes?: string[];
  expectReply: boolean;
  failed?: 'timeout' | 'error';
  /** Set when this turn is an urgent heads-up the page should show as a banner. */
  alert?: { key: string; severity: 'critical' | 'urgent' };
}

export interface BoardIssue {
  key: string;
  summary: string;
  status: string;
  statusCategory: 'todo' | 'inprogress' | 'done';
  assignee?: string;
  priority: string;
  flagged: boolean;
  dueDate?: string;
  blockedBy: string[];
  blocks: string[];
  /** Assigned to the person using the page. */
  mine?: boolean;
}

export interface Backend {
  /** Shown in the header, e.g. "Simulated Jira" or the site name. */
  label: string;
  ask(text: string, opts: { lang?: Lang; minutes?: number }): Promise<Turn>;
  decide(pendingId: string, yes: boolean, lang?: Lang): Promise<Turn>;
  board(): Promise<BoardIssue[]>;
  receipts(lang?: Lang): Promise<ReceiptView[]>;
  undo(receiptId: string): Promise<{ ok: boolean }>;
  /** Urgent heads-up poll. Resolves with an empty speech when there is nothing new. Optional so older backends compile. */
  alerts?(lang: Lang): Promise<Turn>;
  /** Prototype only: drop a Highest-priority outage into the simulated Jira, to show the heads-up. */
  simulateIncident?(): Promise<void>;
  /** Prototype only: a vendor status page reports an outage that touches demo work. */
  simulateOutage?(): Promise<void>;
  /** Live page: whether to offer admin-only demo helpers. */
  pageInfo?(): Promise<{ isAdmin: boolean; projectKey: string }>;
  /** Live page, admins: one-click demo data into an empty project. Resolves with the judge script. */
  loadDemo?(projectKey: string): Promise<{ message: string; script?: { risk: string; talkback: string } }>;
  /** Prototype only: start the story again. */
  reset?(): Promise<void>;
}

/** Speech-to-text source. Each adapter decides how it gets words; the UI only sees text. */
export interface Listener {
  /** Must be called synchronously from a click. Resolves false when listening could not start. */
  start(lang: Lang, on: { partial(text: string): void; final(text: string): void; end(reason?: string): void }): Promise<boolean>;
  stop(): Promise<void>;
}

export type { ReceiptView, Lang };
