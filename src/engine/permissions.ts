// Permission checks for the Siri door, which runs asApp() and must enforce the paired user's
// Jira permissions itself. Pure strategy, no @forge imports; the HTTP calls are injected.
//
// Strategy:
//   1. Bulk check (POST /rest/api/3/permissions/check with accountId). One call for many issues.
//      Atlassian documents that checking ANOTHER user needs Administer Jira. If the app user lacks it
//      the call returns 401/403, and we switch to the fallback for the rest of the invocation.
//   2. Fallback: "find users with permissions" (GET /rest/api/3/user/permission/search) per issue for
//      writes, per project for reads (cached), because per-issue reads would blow the time budget.
//      Known gap: issue-level security schemes are not seen by the per-project read check, so the
//      fallback hides projects the user can't browse but not single secured issues. Documented.
//   3. Any other error: fail closed (deny).

export type PermissionName = 'BROWSE_PROJECTS' | 'EDIT_ISSUES' | 'TRANSITION_ISSUES' | 'ADD_COMMENTS' | 'CREATE_ISSUES';

export interface PermissionHttp {
  /** Bulk check. Returns the issue ids granted per permission, or the HTTP status on failure. */
  bulk(
    accountId: string,
    issueIds: number[],
    permissions: PermissionName[],
  ): Promise<{ ok: true; granted: Map<PermissionName, Set<number>> } | { ok: false; status: number }>;
  /** True if accountId holds all permissions on the issue (or project when only projectKey is given). */
  userHas(
    accountId: string,
    permissions: PermissionName[],
    target: { issueKey: string } | { projectKey: string },
  ): Promise<boolean>;
  /** Issue key -> numeric id, or undefined if the issue doesn't exist. */
  idOf(key: string): Promise<number | undefined>;
}

export class PermissionChecker {
  private mode: 'bulk' | 'fallback' = 'bulk';
  private projectCache = new Map<string, boolean>();

  constructor(private http: PermissionHttp) {}

  get strategy() {
    return this.mode;
  }

  async allowed(
    accountId: string,
    keys: string[],
    permissions: PermissionName[],
    purpose: 'read' | 'write',
  ): Promise<Set<string>> {
    const unique = [...new Set(keys)];
    if (!unique.length) return new Set();

    if (this.mode === 'bulk') {
      try {
        const ids = await Promise.all(unique.map(async (k) => [k, await this.http.idOf(k)] as const));
        const byId = new Map(ids.filter(([, id]) => id !== undefined).map(([k, id]) => [id!, k]));
        if (!byId.size) return new Set();
        const res = await this.http.bulk(accountId, [...byId.keys()], permissions);
        if (res.ok) {
          return new Set(
            [...byId.entries()].filter(([id]) => permissions.every((p) => res.granted.get(p)?.has(id))).map(([, k]) => k),
          );
        }
        if (res.status !== 401 && res.status !== 403) return new Set(); // fail closed
        this.mode = 'fallback';
      } catch {
        return new Set();
      }
    }
    return this.fallback(accountId, unique, permissions, purpose);
  }

  private async fallback(accountId: string, keys: string[], permissions: PermissionName[], purpose: 'read' | 'write') {
    const out = new Set<string>();
    if (purpose === 'write') {
      for (const k of keys) {
        try {
          if (await this.http.userHas(accountId, permissions, { issueKey: k })) out.add(k);
        } catch {
          /* deny */
        }
      }
      return out;
    }
    for (const k of keys) {
      const project = k.split('-')[0];
      const cacheKey = `${accountId}|${project}|${permissions.join(',')}`;
      if (!this.projectCache.has(cacheKey)) {
        let ok = false;
        try {
          ok = await this.http.userHas(accountId, permissions, { projectKey: project });
        } catch {
          ok = false;
        }
        this.projectCache.set(cacheKey, ok);
      }
      if (this.projectCache.get(cacheKey)) out.add(k);
    }
    return out;
  }
}
