// The yes card lists every proposed write; the receipt keeps the full trail; undo reverses
// follow-ups and links HeyBrief created.
import { describe, expect, it } from 'vitest';
import { listReceiptViews, undoReceipt } from '../src/engine/confirm';
import { HeyBrief } from '../src/engine/heybrief';
import { proposalLines } from '../src/engine/receipt';
import { demo, ME } from './helpers';

const STANDUP = "I finished MP-12, MP-15 is blocked on legal, I'll pick up MP-9 today";

describe('yes card', () => {
  it('lists each proposed change and hides audit comments', async () => {
    const { deps, jira } = demo();
    const hb = new HeyBrief(deps, { projectKeys: ['MP'] });
    const p = await hb.talkback(ME.accountId, STANDUP);
    expect(p.changes).toEqual([
      'MP-12 moved to Done',
      'MP-15 moved to Blocked',
      'MP-15 flagged',
      'Owner notified about MP-15',
      'MP-9 moved to In Progress',
      'Standup note added in Confluence (3 lines)',
    ]);
    expect(jira.writes()).toEqual([]);
  });

  it('speaks the card in French and Arabic', async () => {
    const { deps } = demo();
    const hb = new HeyBrief(deps, { projectKeys: ['MP'] });
    const fr = await hb.talkback(ME.accountId, 'j’ai fini MP-12', 'fr');
    expect(fr.changes).toEqual(['MP-12 passe à Terminé', 'Note de standup dans Confluence (1 ligne)']);
    const ar = await hb.talkback(ME.accountId, 'أنهيت MP-12', 'ar');
    expect(ar.changes?.[0]).toBe('MP-12 نُقل إلى منجز');
  });

  it('a risk fix shows the follow-up it would create', async () => {
    const { deps } = demo();
    const hb = new HeyBrief(deps, { projectKeys: ['MP'] });
    const r = await hb.radar(ME.accountId, { kind: 'me', accountId: ME.accountId });
    expect(r.changes?.some((l) => l.startsWith('New follow-up:'))).toBe(true);
  });

  it('a comment alone is the change', () => {
    expect(proposalLines([{ type: 'comment', issueKey: 'MP-1', body: 'x' }])).toEqual(['Comment on MP-1']);
  });
});

describe('receipt trail and undo', () => {
  it('keeps what was said, what was read back, and localises lines', async () => {
    const { deps } = demo();
    const hb = new HeyBrief(deps, { projectKeys: ['MP'] });
    const p = await hb.talkback(ME.accountId, 'I finished MP-12');
    await hb.confirm(ME.accountId, 'yes', p.pendingId);
    const [v] = await listReceiptViews(deps, ME.accountId, 'fr');
    expect(v.heard).toBe('I finished MP-12');
    expect(v.readback).toBe(p.speech);
    expect(v.lines[0].text).toBe('MP-12 passe à Terminé');
    expect(typeof v.planMs).toBe('number');
    expect(typeof v.writeMs).toBe('number');
  });

  it('undo deletes the follow-up a risk fix created, and its link with it', async () => {
    const { deps, jira } = demo();
    const hb = new HeyBrief(deps, { projectKeys: ['MP'] });
    const r = await hb.radar(ME.accountId, { kind: 'me', accountId: ME.accountId });
    await hb.confirm(ME.accountId, 'yes', r.pendingId);
    const [v] = await listReceiptViews(deps, ME.accountId);
    const created = v.lines.find((l) => l.text.startsWith('Created '))!.issueKey!;
    expect(jira.issues.has(created)).toBe(true);
    expect(v.canUndo).toBe(true);
    const out = await undoReceipt(deps, ME.accountId, v.id);
    expect(out.every((x) => x.ok)).toBe(true);
    expect(jira.issues.has(created)).toBe(false);
    for (const i of jira.issues.values()) expect([...i.blocks, ...i.blockedBy]).not.toContain(created);
  });

  it('undo removes a blocker link the update added, but never one that already existed', async () => {
    const { deps, jira } = demo();
    const hb = new HeyBrief(deps, { projectKeys: ['MP'] });
    const p = await hb.talkback(ME.accountId, 'MP-15 is blocked by MP-9');
    await hb.confirm(ME.accountId, 'yes', p.pendingId);
    expect(jira.issues.get('MP-15')!.blockedBy).toContain('MP-9');
    const [v] = await listReceiptViews(deps, ME.accountId);
    await undoReceipt(deps, ME.accountId, v.id);
    expect(jira.issues.get('MP-15')!.blockedBy).not.toContain('MP-9');

    const before = [...jira.issues.get('MP-45')!.blockedBy];
    expect(before).toContain('MP-42');
    const q = await hb.talkback(ME.accountId, 'MP-45 is blocked by MP-42');
    if (q.pendingId) {
      await hb.confirm(ME.accountId, 'yes', q.pendingId);
      const [w] = await listReceiptViews(deps, ME.accountId);
      await undoReceipt(deps, ME.accountId, w.id).catch(() => []);
    }
    expect(jira.issues.get('MP-45')!.blockedBy).toContain('MP-42');
  });
});
