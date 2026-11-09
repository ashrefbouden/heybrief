import { demoDataset } from '../src/engine/demo/data';
import { makeDeps } from '../src/engine/testing/fakes';

/** Monday 2026-11-16 08:30 UTC: a weekday so business-day maths is predictable. */
export const NOW = new Date('2026-11-16T08:30:00Z');
export const ME = { accountId: 'me-1', displayName: 'Ashref Bouden' };

export function demo(now = NOW) {
  const { issues, people } = demoDataset(now, ME);
  return { ...makeDeps(issues, now, people), issues, people };
}
