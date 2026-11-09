// Confluence adapter: one standup page per user per day, appended to on each confirmed update.
// UNVERIFIED until M0: space id lookup and v2 page update payload on the demo site.

import api, { route } from '@forge/api';
import type { ConfluencePort } from '../engine/ports';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class ForgeConfluence implements ConfluencePort {
  constructor(
    private mode: 'user' | 'app',
    private spaceKey: string,
  ) {}

  private req(path: ReturnType<typeof route>, init?: any) {
    const c = this.mode === 'user' ? api.asUser() : api.asApp();
    return c.requestConfluence(path, { ...init, headers: { Accept: 'application/json', 'Content-Type': 'application/json' } });
  }

  async appendStandup(accountId: string, dateIso: string, lines: string[]): Promise<string> {
    const spaces: any = await (await this.req(route`/wiki/api/v2/spaces?keys=${this.spaceKey}`)).json();
    const spaceId = spaces.results?.[0]?.id;
    if (!spaceId) throw new Error(`space ${this.spaceKey} not found`);
    const title = `Standup ${dateIso} (${accountId.slice(-6)})`;
    const items = lines.map((l) => `<li>${esc(l)}</li>`).join('');

    const found: any = await (
      await this.req(route`/wiki/api/v2/pages?space-id=${spaceId}&title=${title}&body-format=storage`)
    ).json();
    const page = found.results?.[0];
    if (!page) {
      const created: any = await (
        await this.req(route`/wiki/api/v2/pages`, {
          method: 'POST',
          body: JSON.stringify({
            spaceId,
            status: 'current',
            title,
            body: { representation: 'storage', value: `<ul>${items}</ul>` },
          }),
        })
      ).json();
      return created._links?.base + created._links?.webui;
    }
    const value = (page.body?.storage?.value ?? '').replace(/<\/ul>\s*$/, '') + items + '</ul>';
    const updated: any = await (
      await this.req(route`/wiki/api/v2/pages/${page.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          id: page.id,
          status: 'current',
          title,
          body: { representation: 'storage', value },
          version: { number: page.version.number + 1 },
        }),
      })
    ).json();
    return updated._links?.base + updated._links?.webui;
  }
}

/** Confluence search for the search_docs action (merged read_page). Runs as the user. */
export async function searchDocs(query: string, limit = 3) {
  const cql = `type=page AND text ~ "${query.replace(/["\\]/g, ' ').slice(0, 200)}"`;
  const res = await api
    .asUser()
    .requestConfluence(route`/wiki/rest/api/search?cql=${cql}&limit=${limit}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Confluence ${res.status}`);
  const j: any = await res.json();
  return (j.results ?? []).map((r: any) => ({
    title: r.title ?? r.content?.title,
    excerpt: (r.excerpt ?? '').replace(/@@@\w*@@@/g, ''),
    url: r.url,
  }));
}
