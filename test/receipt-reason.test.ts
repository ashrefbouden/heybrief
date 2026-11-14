import { describe, expect, it } from 'vitest';
import { describeResult, failureReason } from '../src/engine/receipt';
import type { OpResult } from '../src/engine/types';

const standup = { type: 'standup-page', lines: ['a'] } as OpResult['op'];

describe('receipt failure reasons', () => {
  it('maps raw adapter errors to reasons a person can act on', () => {
    expect(failureReason('permission denied')).toBe('permission');
    expect(failureReason('Jira 403: {"errorMessages":["nope"]}')).toBe('permission');
    expect(failureReason('space TEAM not found')).toBe('noSpace');
    expect(failureReason('Confluence 404: <html>')).toBe('noConfluence');
    expect(failureReason('Jira 404: Issue does not exist')).toBe('notFound');
    expect(failureReason(undefined)).toBe('other');
  });

  it('never shows raw HTTP text in a receipt line, in any language', () => {
    const r: OpResult = { op: standup, ok: false, error: 'Confluence 404: {"message":"No product"}' };
    const en = describeResult(r, 'en').text;
    expect(en).toContain('Confluence is not available on this site');
    expect(en).not.toContain('404');
    expect(describeResult(r, 'fr').text).toContain("Confluence n'est pas disponible");
    expect(describeResult(r, 'ar').text).toContain('Confluence غير متاح');
  });
});
