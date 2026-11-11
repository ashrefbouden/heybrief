// Forge LLM rewords the brief; rules and facts stay in code, and a bad reply falls back to the template.
import { describe, expect, it } from 'vitest';
import { HeyBrief } from '../src/engine/heybrief';
import { demo, ME } from './helpers';

function withPhraser(reply: (draft: string) => string | null | Promise<string | null>) {
  const d = demo();
  const seen: string[] = [];
  d.deps.phraser = {
    async phrase({ draft, facts }) {
      seen.push(facts);
      return reply(draft);
    },
  };
  return { ...d, hb: new HeyBrief(d.deps), seen };
}

describe('LLM phrasing of the brief', () => {
  it('uses the reworded lead and keeps the yes question verbatim', async () => {
    const plain = await new HeyBrief(demo().deps).brief(ME.accountId);
    const { hb, seen } = withPhraser(() => 'Morning. MP-12 comes first today.');
    const a = await hb.brief(ME.accountId);
    expect(a.speech.startsWith('Morning. MP-12 comes first today.')).toBe(true);
    expect(a.speech.endsWith(plain.speech.slice(plain.speech.indexOf('Want me to')))).toBe(true);
    expect(a.pendingId).toBeTruthy();
    expect(seen[0]).toMatch(/MP-12/);
  });

  it('drops a reply that invents an issue key', async () => {
    const plain = await new HeyBrief(demo().deps).brief(ME.accountId);
    const { hb } = withPhraser(() => 'MP-999 is on fire.');
    expect((await hb.brief(ME.accountId)).speech).toBe(plain.speech);
  });

  it('falls back when the model fails or returns nothing', async () => {
    const plain = await new HeyBrief(demo().deps).brief(ME.accountId);
    expect((await withPhraser(() => null).hb.brief(ME.accountId)).speech).toBe(plain.speech);
    const boom = withPhraser(() => {
      throw new Error('LLM down');
    });
    expect((await boom.hb.brief(ME.accountId)).speech).toBe(plain.speech);
  });
});
