// Builds engine dependencies for a request. One place decides asUser vs asApp.

import { randomUUID } from 'node:crypto';
import { HeyBrief } from '../engine/heybrief';
import type { Deps } from '../engine/ports';
import { ForgeConfluence } from '../forge/confluence';
import { ForgeJira } from '../forge/jira';
import { forgePhraser } from '../forge/llm';
import { forgeStore } from '../forge/store';
import { forgeStatus } from '../forge/status';
import { DEFAULT_OUTSIDE, VENDOR_IDS, type OutsideConfig, type VendorId } from '../engine/outside/incidents';

export interface AppSettings {
  projectKeys: string[];
  standupSpaceKey: string;
  /** Outside incidents: off by default. When off, HeyBrief makes no outbound call at all. */
  outside: OutsideConfig;
}

const SETTINGS_KEY = 'settings:app';
// No default project: on a fresh site HeyBrief reads every project the user can see until an admin picks some
// (loading demo data picks the demo project).
const DEFAULTS: AppSettings = { projectKeys: [], standupSpaceKey: '', outside: DEFAULT_OUTSIDE };

export async function loadSettings(): Promise<AppSettings> {
  const saved = (await forgeStore.get<Partial<AppSettings>>(SETTINGS_KEY)) ?? {};
  return { ...DEFAULTS, ...saved, outside: { ...DEFAULT_OUTSIDE, ...(saved.outside ?? {}) } };
}

export async function saveSettings(s: Partial<AppSettings>): Promise<AppSettings> {
  const keys = (s.projectKeys ?? []).map((k) => k.trim().toUpperCase()).filter((k) => /^[A-Z][A-Z0-9_]{0,19}$/.test(k));
  const next = { ...(await loadSettings()), ...(keys.length ? { projectKeys: keys } : {}) };
  if (s.standupSpaceKey === '') next.standupSpaceKey = '';
  else if (s.standupSpaceKey && /^[A-Za-z0-9~]{1,255}$/.test(s.standupSpaceKey)) next.standupSpaceKey = s.standupSpaceKey;
  if (s.outside && typeof s.outside === 'object') {
    const vendors = Array.isArray(s.outside.vendors)
      ? s.outside.vendors.filter((v): v is VendorId => VENDOR_IDS.includes(v as VendorId))
      : next.outside.vendors;
    next.outside = { enabled: s.outside.enabled === true, vendors };
  }
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
    status: settings.outside.enabled ? forgeStatus : undefined,
  };
  return { hb: new HeyBrief(deps, {
      projectKeys: settings.projectKeys,
      outside: settings.outside,
      // No Confluence space chosen: skip the standup note rather than fail every update.
      standupPage: !!settings.standupSpaceKey,
    }), deps, settings };
}
