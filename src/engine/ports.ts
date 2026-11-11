// Ports: the only way the engine touches the outside world.
// Forge implementations live in src/forge; in-memory fakes in src/engine/testing.

import type { Issue, Lang, Scope, Transition } from './types';
import type { StatusPort } from './outside/incidents';

export interface JiraPort {
  /** Open issues in scope, capped (Forge adapter caps at 50 to stay inside the function timeout). */
  searchOpen(scope: Scope): Promise<Issue[]>;
  getIssue(key: string): Promise<Issue | undefined>;
  getTransitions(key: string): Promise<Transition[]>;
  transition(key: string, transitionId: string): Promise<void>;
  addComment(key: string, body: string, mentions?: string[]): Promise<void>;
  setFlag(key: string, flagged: boolean): Promise<void>;
  linkBlocks(blockerKey: string, blockedKey: string): Promise<void>;
  /** Remove a Blocks link (undo). No-op when the link is already gone. */
  unlinkBlocks(blockerKey: string, blockedKey: string): Promise<void>;
  /** Delete an issue (undo of a follow-up HeyBrief created). Jira enforces the delete permission. */
  deleteIssue(key: string): Promise<void>;
  assign(key: string, accountId: string | null): Promise<void>;
  notify(key: string, accountIds: string[], subject: string, body: string): Promise<void>;
  createIssue(input: { projectKey: string; summary: string; assigneeId?: string; dueDate?: string }): Promise<string>;
  /**
   * True when accountId may edit and transition the issue.
   * Required because the Siri door runs asApp: Jira does not enforce the user's permissions for us there.
   */
  canEdit(accountId: string, key: string): Promise<boolean>;
  /** True when accountId may browse the issue. Used to filter asApp reads. */
  canBrowse(accountId: string, keys: string[]): Promise<Set<string>>;
}

export interface ConfluencePort {
  /** Append lines to today's standup page for the user; returns the page URL. */
  appendStandup(accountId: string, dateIso: string, lines: string[]): Promise<string>;
}

/** Key-value store with TTL. Forge adapter is backed by @forge/kvs. */
export interface Store {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  /** Atomic create. Returns false if the key already exists. Used for single-use confirmations. */
  setIfAbsent<T>(key: string, value: T, ttlSeconds?: number): Promise<boolean>;
}

export interface Clock {
  now(): Date;
}

export interface IdGen {
  next(): string;
}

/** Optional LLM phrasing. The engine always has a template answer ready; this only rewords it. */
export interface Phraser {
  phrase(input: { facts: string; draft: string; lang: Lang; maxWords: number }): Promise<string | null>;
}

export interface Deps {
  jira: JiraPort;
  confluence: ConfluencePort;
  store: Store;
  clock: Clock;
  ids: IdGen;
  phraser?: Phraser;
  /** Public vendor status pages, for Outside incidents. Absent means the feature is off. */
  status?: StatusPort;
}
