import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe('architecture rules', () => {
  it('the engine never imports @forge/*', () => {
    for (const f of files('src/engine')) expect(readFileSync(f, 'utf8'), f).not.toMatch(/from '@forge\//);
  });
  it('no currentUser() in JQL (the Siri path runs asApp)', () => {
    for (const f of files('src')) expect(readFileSync(f, 'utf8'), f).not.toMatch(/currentUser\(\)/);
  });
  it('no external fetch: data stays on Atlassian', () => {
    // The SVG XML namespace is an identifier, not a request.
    for (const f of files('src'))
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/\bfetch\(|https?:\/\/(?!example\.atlassian\.net|www\.w3\.org\/2000\/svg)/);
  });
});
