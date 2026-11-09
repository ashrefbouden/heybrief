// Turns parsed intents into concrete Jira ops plus a spoken read-back.
// Nothing here writes: ops are stored as a pending action and run only after a "yes".

import type { JiraPort } from '../ports';
import { capWords, joinList, statusLabel, T } from '../speak';
import type { Issue, Lang, Op } from '../types';
import type { ParsedItem, ParsedUpdate } from './parse';

export interface TalkbackPlan {
  ops: Op[];
  /** One line per issue for the Confluence standup page. */
  standupLines: string[];
  readback: string;
  problems: string[];
  /** Number of issues that will change. 0 means nothing to confirm. */
  changeCount: number;
}

export const AUDIT_SUFFIX = (accountId: string) => `(via HeyBrief voice update, confirmed by [~accountid:${accountId}])`;

export async function planTalkback(
  parsed: ParsedUpdate,
  ctx: { jira: JiraPort; accountId: string; standupPage?: boolean },
): Promise<TalkbackPlan> {
  const { jira, accountId } = ctx;
  const lang = parsed.lang;
  const t = T[lang];
  const ops: Op[] = [];
  const spoken: string[] = [];
  const problems: string[] = [];
  const standupLines: string[] = [];

  for (const item of parsed.items) {
    const issue = await jira.getIssue(item.key);
    if (!issue) {
      problems.push(t.cannot(item.key, lang === 'fr' ? 'introuvable' : lang === 'ar' ? 'غير موجود' : 'not found'));
      continue;
    }
    if (!(await jira.canEdit(accountId, item.key))) {
      problems.push(
        t.cannot(item.key, lang === 'fr' ? 'permission refusée' : lang === 'ar' ? 'لا تملك الصلاحية' : 'you lack permission'),
      );
      continue;
    }
    const res = await planItem(item, issue, { jira, accountId, lang });
    if (res.problem) problems.push(res.problem);
    if (res.ops.length) {
      ops.push(...res.ops);
      spoken.push(res.spoken);
      standupLines.push(res.standup);
    }
  }

  const changeCount = spoken.length;
  if (changeCount && ctx.standupPage !== false) ops.push({ type: 'standup-page', lines: standupLines });

  const parts: string[] = [];
  if (changeCount) {
    parts.push(t.changes(changeCount), spoken.join('. ') + '.');
    if (ctx.standupPage !== false) parts.push(t.plusStandup);
  }
  if (problems.length) parts.push(problems.join(' '));
  if (parsed.unclear.length) parts.push(t.unclear(parsed.unclear.slice(0, 2)));
  if (!changeCount && !problems.length && !parsed.unclear.length) parts.push(t.noChanges);
  if (changeCount) parts.push(t.askYes);

  // "Say yes to save" must survive the word cap, so cap the body and re-append it.
  let readback = parts.join(' ');
  if (changeCount) {
    const body = capWords(parts.slice(0, -1).join(' '), 60 - 5);
    readback = `${body} ${t.askYes}`;
  } else readback = capWords(readback);

  return { ops, standupLines, readback, problems, changeCount };
}

interface ItemPlan {
  ops: Op[];
  spoken: string;
  standup: string;
  problem?: string;
}

async function planItem(item: ParsedItem, issue: Issue, c: { jira: JiraPort; accountId: string; lang: Lang }): Promise<ItemPlan> {
  const t = T[c.lang];
  const audit = AUDIT_SUFFIX(c.accountId);
  const k = issue.key;
  const none: ItemPlan = { ops: [], spoken: '', standup: '' };

  switch (item.intent) {
    case 'done': {
      if (issue.statusCategory === 'done') return { ...none, problem: t.alreadyThere(k, statusLabel(c.lang, 'done')) + '.' };
      const ops: Op[] = [{ type: 'transition', issueKey: k, toCategory: 'done', preferStatus: 'Done' }];
      if (issue.flagged) ops.push({ type: 'flag', issueKey: k, flagged: false });
      ops.push({ type: 'comment', issueKey: k, body: `Marked done. ${audit}` });
      return { ops, spoken: t.moveTo(k, statusLabel(c.lang, 'done')), standup: `Done: ${k} ${issue.summary}` };
    }
    case 'start': {
      if (issue.statusCategory === 'inprogress' && !/block/i.test(issue.status) && issue.assignee?.accountId === c.accountId)
        return { ...none, problem: t.alreadyThere(k, statusLabel(c.lang, 'inprogress')) + '.' };
      const ops: Op[] = [];
      if (issue.statusCategory !== 'inprogress' || /block/i.test(issue.status))
        ops.push({ type: 'transition', issueKey: k, toCategory: 'inprogress', preferStatus: 'In Progress' });
      let spoken = t.moveTo(k, statusLabel(c.lang, 'inprogress'));
      if (issue.assignee?.accountId !== c.accountId) {
        ops.push({ type: 'assign', issueKey: k, accountId: c.accountId });
        spoken += `, ${t.assignedToYou}`;
      }
      ops.push({ type: 'comment', issueKey: k, body: `Picked up. ${audit}` });
      return { ops, spoken, standup: `Today: ${k} ${issue.summary}` };
    }
    case 'blocked': {
      const reason = item.text ?? (item.blockedBy ? item.blockedBy : 'no reason given');
      const ops: Op[] = [{ type: 'transition', issueKey: k, toCategory: 'inprogress', preferStatus: 'Blocked' }];
      if (!issue.flagged) ops.push({ type: 'flag', issueKey: k, flagged: true });
      let spoken = item.blockedBy ? t.blockedBy(k, item.blockedBy) : t.blockedOn(k, reason);
      if (item.blockedBy && !issue.blockedBy.includes(item.blockedBy))
        ops.push({ type: 'link-blocks', blockerKey: item.blockedBy, blockedKey: k });

      // Notify the owner: the blocker issue's assignee when one is named, else the reporter.
      let owner = issue.reporter;
      if (item.blockedBy) owner = (await c.jira.getIssue(item.blockedBy))?.assignee ?? owner;
      ops.push({ type: 'comment', issueKey: k, body: `Blocked: ${reason}. ${audit}`, mentions: owner ? [owner.accountId] : [] });
      if (owner && owner.accountId !== c.accountId) {
        ops.push({
          type: 'notify',
          issueKey: k,
          accountIds: [owner.accountId],
          subject: `${k} is blocked`,
          body: `${k} (${issue.summary}) is blocked: ${reason}.`,
        });
        spoken += `, ${t.tell(owner.displayName.split(' ')[0])}`;
      }
      return { ops, spoken, standup: `Blocked: ${k} ${issue.summary} (${reason})` };
    }
    case 'unblock': {
      const ops: Op[] = [];
      if (/block/i.test(issue.status))
        ops.push({ type: 'transition', issueKey: k, toCategory: 'inprogress', preferStatus: 'In Progress' });
      if (issue.flagged) ops.push({ type: 'flag', issueKey: k, flagged: false });
      if (!ops.length) return { ...none, problem: t.alreadyThere(k, statusLabel(c.lang, 'inprogress')) + '.' };
      ops.push({ type: 'comment', issueKey: k, body: `Unblocked. ${audit}` });
      return { ops, spoken: t.moveTo(k, statusLabel(c.lang, 'inprogress')), standup: `Unblocked: ${k} ${issue.summary}` };
    }
    case 'comment': {
      const body = (item.text ?? '').slice(0, 2000);
      return {
        ops: [{ type: 'comment', issueKey: k, body: `${body} ${audit}` }],
        spoken: t.note(k),
        standup: `Note: ${k} ${body}`,
      };
    }
  }
}

export function describeOps(ops: Op[], lang: Lang): string {
  const keys = [...new Set(ops.flatMap((o) => ('issueKey' in o ? [o.issueKey] : [])))];
  return joinList(keys, lang);
}
