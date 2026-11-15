// Response plan: one approved plan for an incident or a vendor outage, with the release at risk named.
import { describe, expect, it } from 'vitest';
import { detectAlerts } from '../src/engine/alert/detect';
import { releaseAtRisk, withResponsePlan } from '../src/engine/alert/plan';
import { explainAlert, speakAlert } from '../src/engine/alert/speak';
import { outsideAlerts, type VendorIncident } from '../src/engine/outside/incidents';
import { wordCount } from '../src/engine/speak';
import type { Issue, Person } from '../src/engine/types';
import { ME, NOW } from './helpers';

const MIN = 60_000;
const DAY = 86_400_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const inDays = (d: number) => new Date(NOW.getTime() + d * DAY).toISOString().slice(0, 10);
const LINA: Person = { accountId: 'lina', displayName: 'Lina Mansour' };

function issue(p: Partial<Issue> & { key: string }): Issue {
  return {
    projectKey: 'X',
    summary: p.key,
    status: 'To Do',
    statusCategory: 'todo',
    statusChangedAt: ago(10 * MIN),
    updatedAt: ago(10 * MIN),
    createdAt: ago(10 * MIN),
    priority: 'Medium',
    flagged: false,
    blocks: [],
    blockedBy: [],
    ...p,
  };
}

const P1 = issue({ key: 'X-1', summary: 'Checkout API down', priority: 'Highest', issueType: 'Incident', createdAt: ago(5 * MIN) });
const GH: VendorIncident = {
  vendor: 'github',
  id: 'gh1',
  name: 'Actions degraded',
  impact: 'major',
  status: 'investigating',
  components: ['Actions'],
  startedAt: ago(20 * MIN),
};

describe('releaseAtRisk', () => {
  it('picks the soonest unreleased version inside the 7-day window and ignores released or far ones', () => {
    const issues = [
      issue({ key: 'X-1', fixVersions: [{ name: '2.4', releaseDate: inDays(3) }] }),
      issue({ key: 'X-2', fixVersions: [{ name: '2.3', releaseDate: inDays(1), released: true }] }),
      issue({ key: 'X-3', fixVersions: [{ name: '3.0', releaseDate: inDays(20) }] }),
      issue({ key: 'X-4', fixVersions: [{ name: '2.4', releaseDate: inDays(3) }] }),
    ];
    expect(releaseAtRisk(issues, NOW)).toEqual({ name: '2.4', releaseDate: inDays(3), daysLeft: 3, keys: ['X-1', 'X-4'] });
    expect(releaseAtRisk([issues[1], issues[2]], NOW)).toBeUndefined();
  });
});

describe('response plan for an unowned P1', () => {
  it('takes it, starts it, tells the team and opens a post-incident review, all behind one yes', () => {
    const [a0] = detectAlerts([P1], NOW, ME.accountId);
    const a = withResponsePlan(a0, [P1], NOW, ME.accountId);
    expect(a.action.kind).toBe('plan');
    expect(a.action.ops.map((o) => o.type)).toEqual(['assign', 'transition', 'comment', 'create-issue']);
    expect(a.action.ops.at(-1)).toMatchObject({ summary: 'Post-incident review: Checkout API down', assigneeId: ME.accountId });
    expect(speakAlert(a, 'en')).toMatch(/response plan/);
    expect(speakAlert(a, 'fr')).toMatch(/plan de réponse/);
    expect(speakAlert(a, 'ar')).toMatch(/خطة الاستجابة/);
  });

  it('names the release at risk, in the speech and in "why?", and stays under 60 words', () => {
    const inc = { ...P1, fixVersions: [{ name: '2.4', releaseDate: inDays(2) }] };
    const a = withResponsePlan(detectAlerts([inc], NOW, ME.accountId)[0], [inc], NOW, ME.accountId);
    expect(a.facts.release).toBe('2.4');
    expect(speakAlert(a, 'en')).toContain(`Release 2.4, due ${inDays(2)}, is at risk.`);
    expect(speakAlert(a, 'fr')).toContain('La version 2.4');
    expect(wordCount(speakAlert(a, 'en'))).toBeLessThanOrEqual(60);
    expect(explainAlert(a, 'en')).toContain('release 2.4 ships');
  });

  it('leaves a ping (someone else owns it) as a single ping, not a plan', () => {
    const owned = { ...P1, assignee: LINA };
    const a0 = detectAlerts([owned], NOW, ME.accountId)[0];
    expect(withResponsePlan(a0, [owned], NOW, ME.accountId)).toBe(a0);
  });
});

describe('response plan for a vendor outage', () => {
  it('notes the outage on each affected issue naming its owner, and opens one tracking issue (not linked)', () => {
    const work = issue({ key: 'X-7', summary: 'Fix GitHub Actions cache', assignee: LINA, fixVersions: [{ name: '2.4', releaseDate: inDays(4) }] });
    const [a0] = outsideAlerts([GH], [work], NOW, ME.accountId);
    const a = withResponsePlan(a0, [work], NOW, ME.accountId);
    expect(a.action.kind).toBe('plan');
    expect(a.action.ops[0]).toMatchObject({ type: 'comment', issueKey: 'X-7', mentions: ['lina'] });
    expect(a.action.ops[1]).toMatchObject({ type: 'create-issue', summary: 'Track GitHub outage: Actions degraded' });
    expect(a.action.ops[1]).not.toHaveProperty('linkToKey');
    expect(a.severity).toBe('critical');
    expect(speakAlert(a, 'en')).toContain('Release 2.4');
    expect(speakAlert(a, 'ar')).toContain('خطة الاستجابة');
  });

  it('other alerts pass through unchanged', () => {
    const due = issue({ key: 'X-9', priority: 'High', dueDate: inDays(0) });
    const a0 = detectAlerts([due], NOW, ME.accountId)[0];
    expect(withResponsePlan(a0, [due], NOW, ME.accountId)).toBe(a0);
  });
});
