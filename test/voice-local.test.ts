import { describe, expect, it } from 'vitest';
import { localBackend } from '../src/frontend/voice/local';

describe('voice prototype backend (real engine over simulated Jira)', () => {
  it('runs the judge story: risks, why, talk-back, confirm, undo', async () => {
    const b = localBackend();
    const risk = await b.ask("What's at risk this week?", {});
    expect(risk.speech).toMatch(/MP-42/);
    expect(risk.pendingId).toBeTruthy();

    const why = await b.ask('why?', {});
    expect(why.speech).toMatch(/MP-45/);

    const before = await b.board();
    expect(before.find((i) => i.key === 'MP-12')?.status).not.toBe('Done');

    const tb = await b.ask("I finished MP-12, MP-15 is blocked on legal, I'll pick up MP-9 today", {});
    expect(tb.pendingId).toBeTruthy();
    expect((await b.board()).find((i) => i.key === 'MP-12')?.status).toBe(before.find((i) => i.key === 'MP-12')?.status);

    const done = await b.decide(tb.pendingId!, true, 'en');
    expect(done.pendingId).toBeUndefined();
    const after = await b.board();
    expect(after.find((i) => i.key === 'MP-12')?.status).toBe('Done');
    expect(after.find((i) => i.key === 'MP-9')?.statusCategory).toBe('inprogress');

    const [rec] = await b.receipts();
    expect(rec.canUndo).toBe(true);
    expect((await b.undo(rec.id)).ok).toBe(true);
    expect((await b.board()).find((i) => i.key === 'MP-12')?.status).toBe(before.find((i) => i.key === 'MP-12')?.status);
  });

  it('cancel writes nothing, and a stale confirmation id cannot confirm a newer proposal', async () => {
    const b = localBackend();
    const first = await b.ask('I finished MP-12', {});
    const second = await b.ask("I'll pick up MP-9 today", {});
    expect(second.pendingId).not.toBe(first.pendingId);
    await b.decide(first.pendingId!, true, 'en');
    expect(await b.receipts()).toHaveLength(0);
    await b.decide(second.pendingId!, false, 'en');
    expect(await b.receipts()).toHaveLength(0);
  });

  it('answers in Arabic and resets to the same story', async () => {
    const b = localBackend();
    const a = await b.ask('ما هي المخاطر هذا الأسبوع؟', {});
    expect(a.lang).toBe('ar');
    const t = await b.ask('I finished MP-12', {});
    await b.decide(t.pendingId!, true, 'en');
    await b.reset!();
    expect(await b.receipts()).toHaveLength(0);
  });
});

describe('receipt wording', () => {
  it('shows what the person said, not the read-back, for a voice-approved risk fix', async () => {
    const b = localBackend();
    const a = await b.ask('ما هي المخاطر هذا الأسبوع؟', { lang: 'ar' });
    await b.decide(a.pendingId!, true, 'ar');
    const [rec] = await b.receipts();
    expect(rec.heard).toBe('ما هي المخاطر هذا الأسبوع؟');
  });
});
