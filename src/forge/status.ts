// Forge adapter for StatusPort: public Atlassian Statuspage JSON of the vendors an admin picked.
// The ONLY outbound call in HeyBrief. GET only, no query string, no headers carrying user data:
// nothing from Jira is ever sent. The hosts are fixed in VENDORS and declared in manifest.yml.

import { fetch } from '@forge/api';
import { parseStatuspage, VENDORS, type StatusPort, type VendorId, type VendorIncident } from '../engine/outside/incidents';

const TIMEOUT_MS = 3000;

async function one(id: VendorId): Promise<VendorIncident[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://${VENDORS[id].host}/api/v2/incidents/unresolved.json`, {
      headers: { Accept: 'application/json' },
      signal: ctrl.signal as any,
    } as any);
    if (!res.ok) return [];
    return parseStatuspage(id, await res.json());
  } catch {
    return []; // one vendor down or slow never breaks the others, or the page
  } finally {
    clearTimeout(timer);
  }
}

export const forgeStatus: StatusPort = {
  async unresolved(vendors) {
    const known = vendors.filter((v): v is VendorId => v in VENDORS);
    return (await Promise.all(known.map(one))).flat();
  },
};
