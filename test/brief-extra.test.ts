import { describe, expect, it } from 'vitest';
import { newOnMe, waitingOnMe } from '../src/engine/brief/drive';
import { HeyBrief } from '../src/engine/heybrief';
import { demo, ME, NOW } from './helpers';

describe('brief: who is waiting on me, what is new', () => {
  it('names a teammate whose open work waits on mine', async () => {
    const { deps, jira } = demo();
    const mine = [...jira.issues.values()].find((i) => i.assignee?.accountId === ME.accountId && i.statusCategory !== 'done')!;
    const theirs = [...jira.issues.values()].find(
      (i) => i.assignee && i.assignee.accountId !== ME.accountId && i.statusCategory !== 'done',
    )!;
    mine.blocks.push(theirs.key);
    theirs.blockedBy.push(mine.key);
    expect(waitingOnMe([...jira.issues.values()], ME.accountId)).toContainEqual({
      mine: mine.key,
      theirs: theirs.key,
      who: theirs.assignee!.displayName.split(' ')[0],
    });
    const a = await new HeyBrief(deps).brief(ME.accountId, { etaMinutes: 25 });
    expect(a.speech).toContain(`is waiting on your ${mine.key}`);
    expect(a.speech.split(/\s+/).length).toBeLessThanOrEqual(60);
  });

  it('lists my issues created in the last 24 hours, in French too', async () => {
    const { deps, jira } = demo();
    const mine = [...jira.issues.values()].find((i) => i.assignee?.accountId === ME.accountId && i.statusCategory !== 'done')!;
    mine.createdAt = new Date(NOW.getTime() - 3600_000).toISOString();
    expect(newOnMe([...jira.issues.values()], ME.accountId, NOW)).toEqual([mine.key]);
    const a = await new HeyBrief(deps).brief(ME.accountId, { etaMinutes: 25, lang: 'fr' });
    expect(a.speech).toContain(`Nouveau depuis hier : ${mine.key}`);
  });

  it('a short drive stays to one item', async () => {
    const { deps } = demo();
    const a = await new HeyBrief(deps).brief(ME.accountId, { etaMinutes: 3 });
    expect(a.speech).not.toMatch(/waiting|New on you/);
  });
});
