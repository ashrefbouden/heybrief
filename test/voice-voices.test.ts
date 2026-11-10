import { describe, expect, it } from 'vitest';
import { installHint, pickVoice } from '../src/frontend/voice/voices';

const V = (name: string, lang: string) => ({ name, lang });

describe('voice choice for spoken replies', () => {
  const voices = [
    V('Microsoft David - English (United States)', 'en-US'),
    V('Google français', 'fr-FR'),
    V('Microsoft Hortense - French (France)', 'fr-FR'),
    V('Microsoft Naayf - Arabic (Saudi Arabia)', 'ar-SA'),
    V('Microsoft Reem Online (Natural) - Arabic (Tunisia)', 'ar-TN'),
  ];

  it('prefers the Tunisian natural Arabic voice, then any Arabic voice', () => {
    expect(pickVoice(voices, 'ar')?.lang).toBe('ar-TN');
    expect(
      pickVoice(
        voices.filter((v) => v.lang !== 'ar-TN'),
        'ar',
      )?.name,
    ).toMatch(/Naayf/);
  });

  it('prefers a natural French voice over a basic one in the same region', () => {
    expect(pickVoice(voices, 'fr')?.name).toBe('Google français');
  });

  it('accepts underscore tags (Android) and never falls back to another language', () => {
    expect(pickVoice([V('ar', 'ar_EG')], 'ar')?.lang).toBe('ar_EG');
    expect(pickVoice([V('English', 'en-US')], 'ar')).toBeUndefined();
    expect(pickVoice([], 'fr')).toBeUndefined();
  });

  it('gives a platform-specific install hint', () => {
    expect(installHint('ar', 'Mozilla/5.0 (Windows NT 10.0) Chrome/130')).toMatch(/Windows Settings/);
    expect(installHint('ar', 'Mozilla/5.0 (Windows NT 10.0) Chrome/130 Edg/130')).toMatch(/Edge/);
    expect(installHint('fr', 'Mozilla/5.0 (Linux; Android 14)')).toMatch(/Google/);
  });
});
