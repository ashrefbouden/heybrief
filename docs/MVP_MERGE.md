# MVP merge plan

The source is `F:\jira-voice-assistant`: about 1,620 lines of TypeScript, no runtime dependencies, and 43 node:test cases. I reviewed it read-only on Oct 30. The target is this repo.

The cloud build already covers the new pieces: talk-back, the confirm gate, Risk Radar, the drive brief, Siri auth and the demo data. The MVP brings the parts it's best at: intent routing, ranking, speech templates, and the polished brief wording. Estimated effort is about 14 hours, done by me as one PR on the `heybrief` repo once the MVP is on GitHub.

## File by file

| MVP file | Action | Where it goes | Notes |
|---|---|---|---|
| `types.ts` | Merge | `src/engine/types.ts` | Keep our `Issue` as the canonical shape and add any MVP fields it lacks. Map the MVP's `DataSource` types onto `JiraPort`. |
| `intents.ts` | Port | `src/engine/intents.ts` | The MVP router (my day, read issue, search docs, help) runs before our `route()` fallback. Our talk-back, risk and why detection runs first, because it handles writes and must win. |
| `ranking.ts` | Port and replace | `src/engine/brief/rank.ts` | Replaces `rankMyDay()` in `brief/drive.ts`. Keep the drive-budget slice on top. |
| `text.ts` | Port | `src/engine/speak.ts` | Merge the MVP speech templates into `T.en`. Add French and Arabic for each new template (3h, already in the plan). |
| `assistant.ts` | Port | `src/engine/assistant.ts` | It's already built around `DataSource` and `Polisher`. Use `JiraPort` as `DataSource` and `Phraser` as `Polisher`. `HeyBrief.brief()` calls it for the non-drive brief. |
| `mock.ts` | Merge | `src/engine/demo/data.ts` | Keep our demo story, because the three-risk design depends on it. Move any extra MVP fixtures into `test/fixtures/`. |
| `atlassian.ts` | Adapt | `src/forge/jira.ts`, `src/forge/confluence.ts` | Replace `fetch` and Basic auth with `requestJira` / `requestConfluence`. Create a new client per request, because the MVP caches `/myself`. On the Siri path, JQL must use the explicit `accountId`, never `currentUser()`. |
| `llm.ts` | Replace | `src/forge/llm.ts` | Already done. Groq becomes `@forge/llm` with the same guardrail. Keep the MVP system prompt if it's better and diff the two. |
| `api.ts`, `server.ts`, `worker.ts`, `config.ts`, `check.ts`, `push-secrets.ts`, `wrangler.jsonc`, `sw.js` | Drop | | The server, worker, deploy and secrets code are all replaced by Forge modules. |
| `public/app.js` (Web Speech) | Optional | `src/frontend/gadget.tsx` | Adds a "Listen to my day" speech button. UI Kit can't use the Web Speech API, so it would need a small Custom UI resource. This is a "Should" item; decide by Nov 23. |
| Tests (43 node:test) | Port about 25 | `test/mvp-*.test.ts` | Change `node:test` to Vitest: `test` becomes `it`, and `assert.equal(a,b)` becomes `expect(a).toBe(b)`. Drop the tests for dropped files. |

## Order (one PR, separate commits)

1. Copy `types`, `intents`, `ranking`, `text` and `assistant` into `src/engine` and fix imports. The MVP's `.ts` extensions become extensionless; `moduleResolution: Bundler` handles that.
2. Port the tests and get them green on their own.
3. Wire `intents` into `HeyBrief.route()`, and make sure our 129 tests stay green.
4. Replace `rankMyDay` with the MVP ranking. Re-check the drive-brief tests: their expected wording may change, and that's fine if the speech still fits in 60 words.
5. Fold the MVP's `atlassian.ts` extras into `ForgeJira`, such as any JQL or fields we're missing.
6. Run `npm run check`, `forge deploy`, and the judge script.

## Must not regress

- No write without a confirmed pending action, and `jira.writes()` stays empty before a yes. Tests already guard this.
- Every spoken answer stays at 60 words or fewer (test: `wordCount <= 60`).
- No `currentUser()` in JQL on the Siri path.
- No `@forge/*` imports under `src/engine`.

## Also, before Nov 11

From the MVP repo's `.env.example` or `config.ts`, list any settings we haven't carried over, for example the default project or Groq model choice. Then delete the Groq key from your machine once the Forge LLM works.
