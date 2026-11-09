// Runs confirmed ops against Jira and Confluence. Resolves transitions at run time
// (the issue may have moved in the 2 minutes since the read-back), re-checks permission,
// and records how to undo each step for the drive receipt.

import type { Deps } from './ports';
import type { Op, OpResult, Transition } from './types';

export function pickTransition(transitions: Transition[], op: Extract<Op, { type: 'transition' }>): Transition | undefined {
  const want = op.preferStatus?.toLowerCase();
  const byName = want ? transitions.find((t) => t.toStatus.toLowerCase() === want) : undefined;
  if (byName) return byName;
  // A "Blocked" status is optional in many workflows: the flag carries the meaning instead.
  if (want && /block/.test(want)) return undefined;
  return transitions.find((t) => t.toCategory === op.toCategory && !/block/i.test(t.toStatus));
}

export async function executeOps(
  ops: Op[],
  deps: Pick<Deps, 'jira' | 'confluence' | 'clock'>,
  accountId: string,
): Promise<OpResult[]> {
  const { jira, confluence, clock } = deps;
  const results: OpResult[] = [];
  const allowed = new Map<string, boolean>();

  const can = async (key: string) => {
    if (!allowed.has(key)) allowed.set(key, await jira.canEdit(accountId, key));
    return allowed.get(key)!;
  };

  for (const op of ops) {
    try {
      const key = 'issueKey' in op ? op.issueKey : op.type === 'link-blocks' ? op.blockedKey : undefined;
      if (key && !(await can(key))) {
        results.push({ op, ok: false, error: 'permission denied' });
        continue;
      }
      switch (op.type) {
        case 'transition': {
          const issue = await jira.getIssue(op.issueKey);
          if (!issue) throw new Error('issue not found');
          if (op.preferStatus && issue.status.toLowerCase() === op.preferStatus.toLowerCase()) {
            results.push({ op, ok: true });
            break;
          }
          const tr = pickTransition(await jira.getTransitions(op.issueKey), op);
          if (!tr) {
            if (op.preferStatus && /block/i.test(op.preferStatus)) {
              results.push({ op, ok: true, error: 'no Blocked status in workflow; flagged instead' });
              break;
            }
            throw new Error(`no transition to ${op.preferStatus ?? op.toCategory}`);
          }
          await jira.transition(op.issueKey, tr.id);
          results.push({
            op,
            ok: true,
            undo: { type: 'transition', issueKey: op.issueKey, toCategory: issue.statusCategory, preferStatus: issue.status },
          });
          break;
        }
        case 'comment':
          await jira.addComment(op.issueKey, op.body, op.mentions);
          results.push({ op, ok: true });
          break;
        case 'flag':
          await jira.setFlag(op.issueKey, op.flagged);
          results.push({ op, ok: true, undo: { type: 'flag', issueKey: op.issueKey, flagged: !op.flagged } });
          break;
        case 'link-blocks':
          await jira.linkBlocks(op.blockerKey, op.blockedKey);
          results.push({ op, ok: true });
          break;
        case 'assign': {
          const before = await jira.getIssue(op.issueKey);
          await jira.assign(op.issueKey, op.accountId);
          results.push({
            op,
            ok: true,
            undo: before?.assignee ? { type: 'assign', issueKey: op.issueKey, accountId: before.assignee.accountId } : undefined,
          });
          break;
        }
        case 'notify':
          await jira.notify(op.issueKey, op.accountIds, op.subject, op.body);
          results.push({ op, ok: true });
          break;
        case 'create-issue': {
          const createdKey = await jira.createIssue(op);
          if (op.linkToKey) await jira.linkBlocks(createdKey, op.linkToKey);
          results.push({ op, ok: true, createdKey });
          break;
        }
        case 'standup-page': {
          const today = clock.now().toISOString().slice(0, 10);
          await confluence.appendStandup(accountId, today, op.lines);
          results.push({ op, ok: true });
          break;
        }
      }
    } catch (e) {
      results.push({ op, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}
