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
    // The SVG XML namespace is an identifier, not a request. The status-page adapter is the one
    // allowed caller, checked separately below.
    for (const f of files('src').filter((x) => !/forge[\\/]status\.ts$/.test(x)))
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/\bfetch\(|https?:\/\/(?!example\.atlassian\.net|www\.w3\.org\/2000\/svg)/);
  });
  it('the only outbound fetch reads declared public status pages, and sends nothing', async () => {
    const src = readFileSync('src/forge/status.ts', 'utf8');
    expect(src).toMatch(/fetch\(`https:\/\/\$\{VENDORS\[id\]\.host\}\/api\/v2\/incidents\/unresolved\.json`/);
    expect(src).not.toMatch(/method:|body:|\?/);
    const { VENDORS } = await import('../src/engine/outside/incidents');
    const manifest = readFileSync('manifest.yml', 'utf8');
    for (const v of Object.values(VENDORS)) expect(manifest).toContain(`- address: ${v.host}`);
  });
});
