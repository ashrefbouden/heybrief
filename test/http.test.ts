import { describe, expect, it } from 'vitest';
import { readJson } from '../src/forge/http';

const res = (status: number, body: string) => ({ ok: status >= 200 && status < 300, status, text: async () => body });

describe('readJson (Forge responses)', () => {
  it('returns undefined for empty success bodies, not just 204', async () => {
    // PUT /issue/{key}/properties/{p} -> 200/201 empty; POST /issueLink -> 201 empty.
    await expect(readJson(res(201, ''))).resolves.toBeUndefined();
    await expect(readJson(res(200, ''))).resolves.toBeUndefined();
    await expect(readJson(res(204, ''))).resolves.toBeUndefined();
    await expect(readJson(res(200, '  \n'))).resolves.toBeUndefined();
  });

  it('parses a JSON body', async () => {
    await expect(readJson<{ key: string }>(res(201, '{"key":"KAN-1"}'))).resolves.toEqual({ key: 'KAN-1' });
  });

  it('throws with the status and a short body on failure', async () => {
    await expect(readJson(res(400, '{"errors":{"priority":"cannot be set"}}'))).rejects.toThrow(/^Jira 400: .*priority/);
    await expect(readJson(res(404, ''), 'Confluence')).rejects.toThrow('Confluence 404: ');
  });

  it('names a non-JSON success body instead of a bare parse error', async () => {
    await expect(readJson(res(200, '<html>login</html>'))).rejects.toThrow(/not JSON/);
  });
});
