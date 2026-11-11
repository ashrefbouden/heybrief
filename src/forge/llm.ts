// Forge LLM phraser (replaces the MVP's Groq call). Optional by design: every answer already has
// a template; the LLM only rewords it, and guardPhrase drops anything that invents an issue key.

import { chat, list } from '@forge/llm';
import type { Phraser } from '../engine/ports';
import { extractKeys, guardPhrase } from '../engine/speak';

/** A spoken brief cannot wait long: past this the template answer is spoken instead. */
const TIMEOUT_MS = 4500;
let modelId: string | undefined;

/** Pick a Haiku-class model from what the platform offers instead of hard-coding an id. */
async function model(): Promise<string> {
  if (modelId) return modelId;
  const res: any = await list();
  const ids: string[] = (res?.models ?? res?.data ?? []).map((m: any) => m.id ?? m.model ?? m.name).filter(Boolean);
  modelId = ids.find((i) => /haiku/i.test(i)) ?? ids[0];
  if (!modelId) throw new Error('no Forge LLM model available');
  return modelId;
}

const LANG_NAME = { en: 'English', fr: 'French', ar: 'Modern Standard Arabic' } as const;

export const forgePhraser: Phraser = {
  async phrase({ facts, draft, lang, maxWords }) {
    const call = (async () => {
      const r = await chat({
        model: await model(),
        temperature: 0.2,
        max_completion_tokens: 200,
        messages: [
          {
            role: 'system',
            content:
              `Rewrite the draft as a natural spoken morning brief, in ${LANG_NAME[lang]}. Lead with what matters most. ` +
              `At most ${maxWords} words. Use only the facts given. Keep every issue key exactly as written. ` +
              `Never add issue keys, names, dates or numbers that are not in the facts. Output only the sentence.`,
          },
          { role: 'user', content: `Facts:\n${facts}\n\nDraft:\n${draft}` },
        ],
      });
      const c = r.choices?.[0]?.message?.content;
      return typeof c === 'string' ? c : Array.isArray(c) ? c.map((p: any) => p.text ?? '').join('') : null;
    })();
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS));
    try {
      const out = await Promise.race([call, timeout]);
      return guardPhrase(out, extractKeys(facts + ' ' + draft), maxWords);
    } catch {
      return null;
    }
  },
};
