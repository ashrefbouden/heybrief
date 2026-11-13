# HeyBrief

**Talk to Jira, and Jira changes.** A voice-first Forge app: say your status out loud and Jira updates itself after your yes; Risk Radar proposes the fix, not just the alarm. Built for Atlassian Codegeist 2026 (Apps for Software Teams, bonus: Best app with Atlassian MCP).

One engine, four ways in, all running as the signed-in user so Jira enforces permissions:

| Door | Module | Runs as |
|---|---|---|
| Voice page in Jira | `jira:globalPage` (Custom UI): mic, spoken answers, Yes/Cancel, live board, receipt | `asUser()` |
| Rovo chat | `rovo:agent` + 7 `action`s | `asUser()` |
| Claude / any MCP client | `rovo:mcp` (same 7 actions) | `asUser()` |
| Desk | `jira:dashboardGadget` (drive receipt + Risk Radar), `jira:personalSettingsPage` (projects, demo data) | `asUser()` |

Roadmap, not deployed: a Siri / CarPlay door (web trigger + pairing token, `asApp()` with fail-closed permission checks). The code is kept and tested (`src/doors/siri.ts`, `src/engine/siri/auth.ts`, `src/engine/permissions.ts`) but not exported or in the manifest. See `docs/ROADMAP_SIRI.md`.

**Try it without Jira:** `npm run build` writes `dist/heybrief-voice.html`, the same voice console running the real engine over a simulated demo project. Open it in Chrome.

## Layout

```
src/engine/        no @forge imports; 100% unit tested with fakes
  talkback/        parse.ts (spoken update -> intents, EN/FR/AR), plan.ts (intents -> Jira ops + read-back)
  confirm.ts       confirm-before-write gate: 2-min expiry, single use, per user, anything but yes cancels
  execute.ts       runs ops, re-checks permission, resolves transitions at run time, records undo
  risk/            radar.ts (6 deterministic signals, score, one fix per risk), speak.ts (speech + "why?")
  brief/drive.ts   brief sized to the minutes you have
  siri/auth.ts     roadmap: pairing tokens (SHA-256 hash only), rate limit, body validation
  permissions.ts   roadmap (Siri door): bulk check, automatic fallback, fail closed
  receipt.ts       plain-language drive receipt lines
  demo/data.ts     deterministic demo project (exactly 3 risks, judge-script issues)
  demo/seed.ts     one-click seeder for a real site, with simulated history
  testing/fakes.ts FakeJira, FakeConfluence, MemoryStore, FixedClock
  heybrief.ts      use cases every door calls; route() for free speech
src/forge/         adapters: jira.ts (REST v3), confluence.ts, store.ts (KVS), llm.ts (@forge/llm + guardrail)
src/doors/         rovo.ts (actions = MCP tools), resolvers.ts (voice page, gadget, settings), siri.ts (roadmap)
src/frontend/      UI Kit: gadget.tsx, settings.tsx
  voice/           voice console (plain DOM): ui.ts, listeners.ts (dictation / Web Speech), forge.ts, local.ts + proto.ts
scripts/           build-voice.mjs: builds static/voice/build (Forge) and dist/heybrief-voice.html (prototype)
test/              Vitest, 179 tests
docs/              JUDGE_SCRIPT.md (5-minute judge test), NOV10_CHECKLIST.md (PC-back setup), ROADMAP_SIRI.md, MVP_MERGE.md
```

## Commands

```
npm install
npm run check        # typecheck + tests + build the voice page (forge deploy needs static/voice/build)
forge register       # first time only: writes the real app.id into manifest.yml
forge deploy && forge install --site <your-site>.atlassian.net --product jira
```

The manifest validates against `@forge/manifest`'s JSON schema. `forge lint` needs `forge login`.

## Status (Nov 10)

Done and tested offline: voice page and browser prototype, talk-back parsing and planning, confirm gate, executor with undo, Risk Radar, drive brief, demo data and seeder, permission fallback, write budget (30 confirmed batches per user per hour), spoken errors and a 20 s deadline on every door, all speech in EN/FR/AR.

Written but **not yet run against a real site** (needs Ashref's machine and the demo site, M0 Nov 10-11). Verify these first:

1. Microphone inside the Forge page. Custom UI runs in an iframe; if the browser refuses speech recognition there, the page hides the mic and typing still works. Browser or OS dictation (Win+H, Fn Fn on Mac) into the text box is the fallback.
2. Where action functions receive the caller's accountId (`accountIdOf()` in `doors/rovo.ts`).
3. `issueLink` direction for "Blocks" (`linkBlocks()` in `forge/jira.ts`).
4. "Flagged" field lookup and value on the demo site.
5. `@forge/llm` `list()` response shape (model picked by name, no hard-coded id).
6. The `board` resolver's JQL on the demo project, and text-to-speech voices on the demo machine.
7. Whether the bundler is happy with extensionless imports (we use them; the MVP's `.ts` imports should be converted when ported).

## Merging the MVP

The engine was designed around the MVP's split (types / intents / ranking / text / assistant with DataSource + Polisher). When the MVP is on GitHub: move its router, ranking and templates into `src/engine`, replace `rankMyDay` in `brief/drive.ts` with the MVP ranking, and port its ~25 reusable tests to Vitest.

## Voice in English, French and Arabic

The language menu on the voice page sets both the microphone language (en-US, fr-FR, ar-TN) and the spoken voice. HeyBrief picks the best installed voice for that language (natural/online voices first, Tunisian Arabic first) and never reads French or Arabic with an English voice: if none is installed, the page says so, shows how to add one, and answers in text.

| Browser | Mic in French / Arabic | Spoken French | Spoken Arabic |
|---|---|---|---|
| Microsoft Edge (Windows, Mac) | Yes | Yes (online natural voices) | Yes (online natural voices, incl. Tunisian) |
| Chrome on Windows | Yes | Yes (Google voice) | Only if a Windows Arabic voice is installed |
| Chrome on Mac | Yes | Yes | Yes, with the macOS Arabic voice (Majed) downloaded |
| Chrome on Android | Yes | Yes | Yes, with Arabic in Google text-to-speech |
| Safari (Mac, iPhone) | Patchy | Yes | Yes, with an Arabic voice downloaded |
| Firefox | No (typing only) | Yes, with OS voices | With OS voices |

From memory of browser behaviour, to be confirmed on the demo machine. For the demo video, use Edge.
