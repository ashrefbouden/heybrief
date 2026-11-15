// Outside incidents: vendor outages from public status pages, matched to open work, behind the yes gate.
import { describe, expect, it } from 'vitest';
import { HeyBrief } from '../src/engine/heybrief';
import { affected, outsideAlerts, parseStatuspage, VENDOR_IDS, type VendorIncident } from '../src/engine/outside/incidents';
import { demo, ME, NOW } from './helpers';
import { speakAlert } from '../src/engine/alert/speak';

const GH: VendorIncident = {
  vendor: 'github',
  id: 'abc',
  name: 'Degraded performance for GitHub Actions',
  impact: 'major',
  status: 'investigating',
  components: ['Actions'],
  url: 'https://stspg.io/x',
  startedAt: new Date(NOW.getTime() - 12 * 60_000).toISOString(),
};

function setup(incidents: VendorIncident[] | (() => Promise<VendorIncident[]>), enabled = true) {
  const d = demo();
  let calls = 0;
  d.deps.status = {
    async unresolved() {
      calls++;
      return typeof incidents === 'function' ? incidents() : incidents;
    },
  };
  const hb = new HeyBrief(d.deps, { projectKeys: ['MP'], outside: { enabled, vendors: VENDOR_IDS } });
  return { ...d, hb, calls: () => calls };
}

describe('Outside incidents', () => {
  it('parses a Statuspage body and ignores junk', () => {
    const body = {
      incidents: [
        { id: '1', name: 'API down', impact: 'critical', status: 'identified', shortlink: 'https://stspg.io/1', started_at: NOW.toISOString(), components: [{ name: 'API' }] },
        { id: 2, name: 'bad id' },
        { id: '3', name: 'Odd impact', impact: 'weird', shortlink: 'javascript:alert(1)' },
      ],
    };
    const out = parseStatuspage('github', body);
    expect(out.map((i) => i.id)).toEqual(['1', '3']);
    expect(out[0]).toMatchObject({ impact: 'critical', components: ['API'], url: 'https://stspg.io/1' });
    expect(out[1]).toMatchObject({ impact: 'minor', url: undefined });
    expect(parseStatuspage('github', null)).toEqual([]);
    expect(parseStatuspage('github', { incidents: 'x' })).toEqual([]);
  });

  it('matches issues that name the vendor first, and stays quiet when nothing matches', () => {
    const { issues } = demo();
    expect(affected(GH, issues)).toEqual({ keys: ['MP-12'], strong: true });
    const cf: VendorIncident = { ...GH, vendor: 'cloudflare', name: 'DNS issues' };
    expect(affected(cf, issues).keys).toEqual([]);
    expect(outsideAlerts([cf], issues, NOW, ME.accountId)).toEqual([]);
  });

  it('interrupts once with the vendor, the affected issue and a proposed note; nothing written before yes', async () => {
    const { hb, jira } = setup([GH]);
    const a = await hb.alerts(ME.accountId, {});
    expect(a.speech).toContain('GitHub reports: Degraded performance for GitHub Actions');
    expect(a.speech).toContain('MP-12');
    expect(a.speech).toMatch(/Want me to run the response plan: note the GitHub outage on MP-12, tell their owners, and open a tracking issue\?$/);
    expect(a.changes).toHaveLength(2);
    expect(a.changes![1]).toBe('New follow-up: Track GitHub outage: Degraded performance for GitHub Actions');
    expect(a.changes![0]).toMatch(/^Comment on MP-12: “Heads-up: GitHub reports/);
    expect(jira.writes()).toEqual([]);
    expect((await hb.alerts(ME.accountId, {})).speech).toBe(''); // a pending yes blocks a second interruption
    await hb.confirm(ME.accountId, 'yes', a.pendingId);
    expect(jira.comments.at(-1)).toMatchObject({ key: 'MP-12' });
    expect(jira.comments.at(-1)!.body).toContain('https://stspg.io/x');
    expect((await hb.alerts(ME.accountId, {})).speech).toBe(''); // announced once
  });

  it('speaks French and Arabic', async () => {
    const fr = await setup([GH]).hb.alerts(ME.accountId, { lang: 'fr' });
    expect(fr.speech).toContain('GitHub signale');
    const ar = await setup([GH]).hb.alerts(ME.accountId, { lang: 'ar' });
    expect(ar.speech).toContain('GitHub يبلّغ');
  });

  it('is off by default: no status call at all', async () => {
    const s = setup([GH], false);
    expect((await s.hb.alerts(ME.accountId, { ask: true })).speech).not.toContain('GitHub');
    expect(s.calls()).toBe(0);
  });

  it('caches status pages for two minutes and survives a failing vendor', async () => {
    const s = setup([GH]);
    await s.hb.alerts(ME.accountId, { ask: true });
    await s.hb.alerts(ME.accountId, { ask: true });
    expect(s.calls()).toBe(1);
    const broken = setup(async () => {
      throw new Error('status down');
    });
    expect((await broken.hb.alerts(ME.accountId, { ask: true })).speech).toBeTruthy();
  });

  it('only issues naming the vendor match: component names like "Build Pipeline" never do', () => {
    const { issues } = demo();
    const mp38 = issues.find((i) => i.key === 'MP-38')!;
    mp38.labels = [];
    mp38.summary = 'Speed up the build pipeline cache';
    const vercel: VendorIncident = { ...GH, vendor: 'vercel', name: 'Build delays', components: ['API', 'Build Pipeline'] };
    expect(outsideAlerts([vercel], issues, NOW, ME.accountId)).toEqual([]);
    mp38.summary = 'Fix Vercel preview deployment';
    const [a] = outsideAlerts([vercel], issues, NOW, ME.accountId);
    expect(a).toMatchObject({ issueKey: 'MP-38', confidence: 'confirmed' });
  });
});
