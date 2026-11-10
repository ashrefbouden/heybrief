// Language tags and voice choice for spoken replies. Pure functions, so they are unit-tested without a browser.

import type { Lang } from './types';

/** Speech recognition locale per conversation language. Tunisian Arabic is understood by Chrome and Edge. */
export const LISTEN_LOCALE: Record<Lang, string> = { en: 'en-US', fr: 'fr-FR', ar: 'ar-TN' };

/** Voices we prefer, best first, within a language: exact region, then any region of that language. */
const PREFERRED_REGION: Record<Lang, string[]> = {
  en: ['en-US', 'en-GB'],
  fr: ['fr-FR', 'fr-CA', 'fr-BE', 'fr-CH'],
  ar: ['ar-TN', 'ar-SA', 'ar-EG', 'ar-AE', 'ar-MA', 'ar-DZ'],
};

export interface VoiceLike {
  name: string;
  lang: string;
  localService?: boolean;
}

const norm = (tag: string) => tag.replace('_', '-').toLowerCase();

/** Natural/neural voices (Edge "Online (Natural)", Google, macOS Premium/Enhanced) sound far better. */
function quality(v: VoiceLike): number {
  return /natural|neural|online|google|premium|enhanced/i.test(v.name) ? 1 : 0;
}

/** Best installed voice for a language, or undefined when the device has none (never fall back to another language). */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], lang: Lang): V | undefined {
  const regions = PREFERRED_REGION[lang].map(norm);
  const mine = voices.filter((v) => norm(v.lang).split('-')[0] === lang);
  if (!mine.length) return undefined;
  const rank = (v: V) => {
    const r = regions.indexOf(norm(v.lang));
    return (r === -1 ? regions.length : r) - quality(v) * 0.5;
  };
  return [...mine].sort((a, b) => rank(a) - rank(b))[0];
}

export const LANG_NAME: Record<Lang, string> = { en: 'English', fr: 'Français', ar: 'العربية' };

/** Where to get a voice when none is installed, by platform. */
export function installHint(lang: Lang, ua: string): string {
  const name = lang === 'ar' ? 'Arabic' : lang === 'fr' ? 'French' : 'English';
  const aName = lang === 'fr' ? 'a French' : `an ${name}`;
  if (/Edg\//.test(ua)) return `Microsoft Edge normally includes online ${name} voices; check you are online.`;
  if (/Windows/.test(ua)) return `Add ${aName} voice in Windows Settings > Time & language > Speech, or use Microsoft Edge.`;
  if (/Android/.test(ua)) return `Install ${name} in Settings > Text-to-speech > Speech Services by Google.`;
  if (/iPhone|iPad|Mac OS/.test(ua)) return `Download ${aName} voice in Settings > Accessibility > Spoken Content > Voices.`;
  return `Install ${aName} text-to-speech voice for your system, or use Microsoft Edge.`;
}
