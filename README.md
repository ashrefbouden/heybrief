# HeyBrief

**Talk to Jira, and Jira changes.** A hands-free Forge app: report status from the car and Jira updates itself after your spoken yes; Risk Radar proposes the fix, not just the alarm. Built for Atlassian Codegeist 2026 (Business Teams track, Best app with Atlassian MCP).

One engine, three ways in:

| Door | Module | Runs as | Who checks permissions |
|---|---|---|---|
| Siri / CarPlay | `webtrigger` (`siri`) + pairing token | `asApp()` | HeyBrief, via the bulk permission check (fail closed) |
| Rovo chat | `rovo:agent` + 7 `action`s | `asUser()` | Jira |
| Claude / any MCP client | `rovo:mcp` (same 7 actions) | `asUser()` | Jira |
| Desk | `jira:dashboardGadget` (drive receipt + Risk Radar), `jira:personalSettingsPage` (pairing) | `asUser()` | Jira |

## Layout

```
src/engine/        no @forge imports; 100% unit tested with fakes
  talkback/        parse.ts (spoken update -> intents, EN/FR/AR), plan.ts (intents -> Jira ops + read-back)
  confirm.ts       confirm-before-write gate: 2-min expiry, single use, per user, anything but yes cancels
  execute.ts       runs ops, re-checks permission, resolves transitions at run time, records undo
  risk/            radar.ts (6 deterministic signals, score, one fix per risk), speak.ts (speech + "why?")
  brief/drive.ts   drive-sized brief from the Shortcut's ETA
  siri/auth.ts     pairing tokens (SHA-256 hash only), rate limit, body validation
  demo/data.ts     deterministic demo project (exactly 3 risks, judge-script issues)
  testing/fakes.ts FakeJira, FakeConfluence, MemoryStore, FixedClock
  heybrief.ts      use cases every door calls; route() for free speech
src/forge/         adapters: jira.ts (REST v3), confluence.ts, store.ts (KVS), llm.ts (@forge/llm + guardrail)
src/doors/         siri.ts (web trigger), rovo.ts (actions = MCP tools), resolvers.ts (gadget + settings)
src/frontend/      UI Kit: gadget.tsx, settings.tsx
test/              Vitest, 106 tests
```

## Commands

```
npm install
npm run check        # typecheck + tests
forge register       # first time only: writes the real app.id into manifest.yml
forge deploy && forge install --site <your-site>.atlassian.net --product jira
```

The manifest validates against `@forge/manifest`'s JSON schema. `forge lint` needs `forge login`.

## Status (Nov 9)

Done and tested offline: talk-back parsing and planning, confirm gate, executor with undo, Risk Radar, drive brief, Siri auth, demo data, all speech in EN/FR/AR.

Written but **not yet run against a real site** (needs Ashref's machine and the demo site, M0 Nov 10-11). Verify these first:

1. `POST /rest/api/3/permissions/check` with another user's accountId from `asApp()`. Atlassian documents it as needing Administer Jira for other users. If refused, switch the Siri path to `GET /rest/api/3/user/permission/search?accountId=&permissions=&issueKey=` for writes and project-level browse checks for reads. **This is the main Siri risk.**
2. Where action functions receive the caller's accountId (`accountIdOf()` in `doors/rovo.ts`).
3. `issueLink` direction for "Blocks" (`linkBlocks()` in `forge/jira.ts`).
4. "Flagged" field lookup and value on the demo site.
5. `@forge/llm` `list()` response shape (model picked by name, no hard-coded id).
6. Whether the bundler is happy with extensionless imports (we use them; the MVP's `.ts` imports should be converted when ported).

## Merging the MVP

The engine was designed around the MVP's split (types / intents / ranking / text / assistant with DataSource + Polisher). When the MVP is on GitHub: move its router, ranking and templates into `src/engine`, replace `rankMyDay` in `brief/drive.ts` with the MVP ranking, and port its ~25 reusable tests to Vitest.
