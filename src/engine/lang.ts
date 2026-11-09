import type { Lang } from './types';

const ARABIC = /[؀-ۿ]/;
const FRENCH_MARKERS =
  /[éèêàçùûôî]|\b(je|j'|j’|est|sont|le|la|les|du|des|une?|aujourd'hui|aujourd’hui|fini|terminée?|bloquée?|prends|commence|demain|oui|non)\b/i;

/** Best-effort language of a short utterance. A language passed explicitly (e.g. by Siri) wins. */
export function detectLang(text: string, hint?: string): Lang {
  const h = hint?.slice(0, 2).toLowerCase();
  if (h === 'en' || h === 'fr' || h === 'ar') return h;
  if (ARABIC.test(text)) return 'ar';
  const frHits = text.match(new RegExp(FRENCH_MARKERS.source, 'gi'))?.length ?? 0;
  return frHits >= 2 ? 'fr' : 'en';
}
