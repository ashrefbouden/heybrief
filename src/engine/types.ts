// Core domain types for the HeyBrief engine.
// The engine never imports @forge/*: everything platform-specific comes in through ports.ts.

export type Lang = 'en' | 'fr' | 'ar';

export type StatusCategory = 'todo' | 'inprogress' | 'done';

export type Priority = 'Highest' | 'High' | 'Medium' | 'Low' | 'Lowest';

export interface Person {
  accountId: string;
  displayName: string;
}

export interface Issue {
  key: string;
  projectKey: string;
  summary: string;
  status: string;
  statusCategory: StatusCategory;
  /** ISO timestamp of when the issue entered its current status. */
  statusChangedAt: string;
  /** ISO timestamp of the last update of any kind. */
  updatedAt: string;
  priority: Priority;
  assignee?: Person;
  reporter?: Person;
  /** YYYY-MM-DD */
  dueDate?: string;
  flagged: boolean;
  /** Keys of issues this issue blocks (outward "blocks" links). */
  blocks: string[];
  /** Keys of issues that block this issue (inward "is blocked by" links). */
  blockedBy: string[];
  epicKey?: string;
  /** Issue type name (Task, Bug, Incident...). Optional: only urgent alerts read it. */
  issueType?: string;
  labels?: string[];
  /** ISO timestamp the issue was created. */
  createdAt?: string;
  /** Fix versions (releases). Optional: only the response plan reads them. */
  fixVersions?: { name: string; releaseDate?: string; released?: boolean }[];
}

export interface Transition {
  id: string;
  name: string;
  toStatus: string;
  toCategory: StatusCategory;
}

export function isOpen(issue: Issue): boolean {
  return issue.statusCategory !== 'done';
}

export function isBlocked(issue: Issue): boolean {
  return issue.flagged || /blocked|bloqu|محظور|متوقف/i.test(issue.status);
}

/** Scope of a query: the speaker's own work, a project, or an epic. */
export type Scope =
  { kind: 'me'; accountId: string } | { kind: 'project'; projectKey: string } | { kind: 'epic'; epicKey: string };

/** A single write the engine wants to make. Ops are resolved again at execute time. */
export type Op =
  | { type: 'transition'; issueKey: string; toCategory: StatusCategory; preferStatus?: string }
  | { type: 'comment'; issueKey: string; body: string; mentions?: string[] }
  | { type: 'flag'; issueKey: string; flagged: boolean }
  | { type: 'link-blocks'; blockerKey: string; blockedKey: string }
  /** Undo of link-blocks. */
  | { type: 'unlink-blocks'; blockerKey: string; blockedKey: string }
  /** Undo of create-issue: only ever targets an issue HeyBrief created. */
  | { type: 'delete-issue'; issueKey: string }
  | { type: 'assign'; issueKey: string; accountId: string | null }
  | { type: 'notify'; issueKey: string; accountIds: string[]; subject: string; body: string }
  | {
      type: 'create-issue';
      projectKey: string;
      summary: string;
      assigneeId?: string;
      dueDate?: string;
      linkToKey?: string;
    }
  | { type: 'standup-page'; lines: string[] };

/** What an Op did, plus what is needed to undo it (for the drive receipt). */
export interface OpResult {
  op: Op;
  ok: boolean;
  error?: string;
  createdKey?: string;
  undo?: Op;
}

export interface Receipt {
  id: string;
  accountId: string;
  at: string;
  kind: PendingKind;
  heard: string;
  /** What HeyBrief read back before the yes. Optional: receipts stored before Nov 11 lack it. */
  readback?: string;
  results: OpResult[];
  /** Measured: from the sentence arriving to the proposal being ready. */
  planMs?: number;
  /** Measured: from the yes to the last write finishing. */
  writeMs?: number;
}

export type PendingKind = 'talkback' | 'risk-fix' | 'alert';

export interface PendingAction {
  id: string;
  accountId: string;
  kind: PendingKind;
  ops: Op[];
  /** What the user said or was told, kept for the drive receipt. */
  heard: string;
  readback: string;
  expiresAt: string;
  planMs?: number;
}
