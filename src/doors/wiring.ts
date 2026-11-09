// Builds engine dependencies for a request. One place decides asUser vs asApp.

import { randomUUID } from 'node:crypto';
import { HeyBrief } from '../engine/heybrief';
import type { Deps } from '../engine/ports';
import { ForgeConfluence } from '../forge/confluence';
import { ForgeJira } from '../forge/jira';
import { forgePhraser } from '../forge/llm';
import { forgeStore } from '../forge/store';

export interface AppSettings {
  projectKeys: string[];
  standupSpaceKey: string;
}

const SETTINGS_KEY = 'settings:app';
const DEFAULTS: AppSettings = { projectKeys: ['MP'], standupSpaceKey: 'MP' };

export async function loadSettings(): Promise<AppSettings> {
  return { ...DEFAULTS, ...((await forgeStore.get<AppSettings>(SETTINGS_KEY)) ?? {}) };
}

export async function saveSettings(s: Partial<AppSettings>): Promise<AppSettings> {
  const keys = (s.projectKeys ?? []).map((k) => k.trim().toUpperCase()).filter((k) => /^[A-Z][A-Z0-9_]{0,19}$/.test(k));
  const next = { ...(await loadSettings()), ...(keys.length ? { projectKeys: keys } : {}) };
  if (s.standupSpaceKey && /^[A-Za-z0-9~]{1,255}$/.test(s.standupSpaceKey)) next.standupSpaceKey = s.standupSpaceKey;
  await forgeStore.set(SETTINGS_KEY, next);
  return next;
}

/** user: Rovo, MCP, gadget (Jira enforces permissions). app: Siri (we enforce them, fail closed). */
export async function engineFor(mode: { kind: 'user' } | { kind: 'app'; accountId: string }) {
  const settings = await loadSettings();
  const deps: Deps = {
    jira: new ForgeJira(mode, settings.projectKeys),
    confluence: new ForgeConfluence(mode.kind, settings.standupSpaceKey),
    store: forgeStore,
    clock: { now: () => new Date() },
    ids: { next: () => randomUUID() },
    phraser: forgePhraser,
  };
  return { hb: new HeyBrief(deps, { projectKeys: settings.projectKeys }), deps, settings };
}
