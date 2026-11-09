import { describe, expect, it } from 'vitest';
import { normaliseKeys, parseUpdate } from '../src/engine/talkback/parse';

const P = ['MP'];
const parse = (s: string, lang?: string) => parseUpdate(s, { projectKeys: P, lang });
const pairs = (s: string, lang?: string) => parse(s, lang).items.map((i) => `${i.intent}:${i.key}`);

describe('normaliseKeys', () => {
  it('turns speech-to-text variants into issue keys', () => {
    expect(normaliseKeys('mp 12 and MP12 and MP-12', P)).toBe('MP-12 and MP-12 and MP-12');
  });
  it('ignores prefixes that are not project keys', () => {
    expect(normaliseKeys('Q4 3 and PR 2 and MP 7', P)).toBe('Q4 3 and PR 2 and MP-7');
  });
  it('without project keys, only uppercase prefixes count', () => {
    expect(normaliseKeys('in 3 days ABC 4', undefined)).toBe('in 3 days ABC-4');
  });
});

describe('parseUpdate (English)', () => {
  it('parses the judge script sentence into three intents', () => {
    const r = parse("I finished MP-12, MP-15 is blocked on legal, I'll pick up MP-9 today");
    expect(r.lang).toBe('en');
    expect(r.items).toEqual([
      expect.objectContaining({ key: 'MP-12', intent: 'done' }),
      expect.objectContaining({ key: 'MP-15', intent: 'blocked', text: 'legal' }),
      expect.objectContaining({ key: 'MP-9', intent: 'start' }),
    ]);
    expect(r.unclear).toEqual([]);
  });

  it('keeps a multi-word blocker reason joined by "and"', () => {
    const r = parse('MP-15 is blocked on legal and finance');
    expect(r.items[0].text).toBe('legal and finance');
  });

  it('detects a blocker issue key in the reason and links it', () => {
    const r = parse('MP-15 is blocked by MP-7');
    expect(r.items[0]).toMatchObject({ key: 'MP-15', intent: 'blocked', blockedBy: 'MP-7' });
    expect(r.items).toHaveLength(1);
  });

  it('a bare second key inherits the previous intent', () => {
    expect(pairs('I finished MP-12 and MP-13')).toEqual(['done:MP-12', 'done:MP-13']);
  });

  it('two keys in one clause share the intent', () => {
    expect(pairs('MP-3 MP-4 are done')).toEqual(['done:MP-3', 'done:MP-4']);
  });

  it('never writes a negated statement', () => {
    const r = parse('MP-12 is not finished yet');
    expect(r.items).toEqual([]);
    expect(r.unclear).toHaveLength(1);
  });

  it('unblocked is not blocked', () => {
    expect(pairs('MP-15 is unblocked now')).toEqual(['unblock:MP-15']);
    expect(pairs('MP-15 is no longer blocked')).toEqual(['unblock:MP-15']);
  });

  it('reports clauses with a key but no intent as unclear', () => {
    const r = parse('MP-12 something something');
    expect(r.items).toEqual([]);
    expect(r.unclear).toEqual(['MP-12 something something']);
  });

  it('ignores chatter with no issue key', () => {
    const r = parse('ok so, I finished MP-12');
    expect(pairs('ok so, I finished MP-12')).toEqual(['done:MP-12']);
    expect(r.unclear).toEqual([]);
  });

  it('last statement about the same issue wins', () => {
    expect(pairs("I'll start MP-3, actually MP-3 is done")).toEqual(['done:MP-3']);
  });

  it('parses a note into a comment intent', () => {
    const r = parse('note on MP-12: waiting for design review');
    expect(r.items[0]).toMatchObject({ key: 'MP-12', intent: 'comment' });
    expect(r.items[0].text).toContain('waiting for design review');
  });

  it('handles Siri dictation without dashes', () => {
    expect(pairs('I finished MP 12 then started MP 9')).toEqual(['done:MP-12', 'start:MP-9']);
  });

  it('waiting on counts as blocked', () => {
    expect(parse('MP-15 waiting on legal').items[0]).toMatchObject({ intent: 'blocked', text: 'legal' });
  });
});

describe('parseUpdate (French)', () => {
  it('parses a French update', () => {
    const r = parse("J'ai terminé MP-12, MP-15 est bloqué par le juridique, je prends MP-9 aujourd'hui");
    expect(r.lang).toBe('fr');
    expect(r.items.map((i) => `${i.intent}:${i.key}`)).toEqual(['done:MP-12', 'blocked:MP-15', 'start:MP-9']);
    expect(r.items[1].text).toBe('le juridique');
  });
  it('French negation is unclear, not done', () => {
    expect(parse("MP-12 n'est pas fini").items).toEqual([]);
  });
  it('débloqué is unblock', () => {
    expect(pairs('MP-15 est débloqué')).toEqual(['unblock:MP-15']);
  });
});

describe('parseUpdate (Arabic)', () => {
  it('parses an Arabic update', () => {
    const r = parse('أنهيت MP-12، MP-15 متوقف بسبب القسم القانوني، سأبدأ MP-9 اليوم');
    expect(r.lang).toBe('ar');
    expect(r.items.map((i) => `${i.intent}:${i.key}`)).toEqual(['done:MP-12', 'blocked:MP-15', 'start:MP-9']);
    expect(r.items[1].text).toContain('القسم القانوني');
  });
  it('Arabic negation is unclear', () => {
    expect(parse('لم أنهي MP-12').items).toEqual([]);
  });
  it('accepts an attached waw prefix', () => {
    expect(pairs('وأنهيت MP-12')).toEqual(['done:MP-12']);
  });
});

describe('parseUpdate safety', () => {
  it('an unknown verb does not inherit the previous intent', () => {
    const r = parse('I finished MP-12 then reviewed MP-9');
    expect(r.items.map((i) => `${i.intent}:${i.key}`)).toEqual(['done:MP-12']);
    expect(r.unclear).toEqual(['reviewed MP-9']);
  });
  it('"MP-13 too" still inherits', () => {
    expect(pairs('finished MP-12, MP-13 too')).toEqual(['done:MP-12', 'done:MP-13']);
  });
});
