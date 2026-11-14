# HeyBrief demo video: script and shot list (2:45 max)

Record in one sitting in Microsoft Edge, on the demo site, after a fresh **Load demo data** on a clean project. Screen recorder: Xbox Game Bar (Win+G, free) or OBS. 1920x1080, browser zoom 110 %. Mic close, quiet room. Never film while driving.

## Before you hit record (5 minutes)

1. Fresh project (key `HB`) with **Load demo data**, so the board has exactly 3 risks.
2. Tabs open, in this order: (1) HeyBrief voice page, (2) the Jira board for `HB`, (3) Rovo chat with the HeyBrief agent, (4) Claude with the HeyBrief MCP server connected, (5) `docs/architecture.png`.
3. Edge: sound on, notifications off, bookmarks bar hidden.
4. Do one dry run of shots 2 to 5, then **Undo** everything so the board is clean again.

## Script

| # | Time | Screen | You say (voice-over) or do |
|---|---|---|---|
| 1 | 0:00-0:12 | Voice page, nothing typed yet | VO: "Every standup, someone spends ten minutes clicking through Jira to say what they already know. What if you could just say it, and Jira changed?" |
| 2 | 0:12-0:30 | Click **Simulate P1 outage**. Heads-up banner + chime appear | VO: "Here's a production outage arriving. HeyBrief interrupts me, says what happened, and proposes one action." Let the spoken Heads-up play. |
| 3 | 0:30-0:45 | Say **"yes"**. Switch to the Jira board tab: the incident is assigned to you and In Progress | VO: "I say yes, and Jira changes. Assigned to me, started, with an audit comment that names me." |
| 4 | 0:45-0:55 | Back to the voice page, click **Undo** on the receipt; board goes back | VO: "Every change can be undone. Nothing is written without a yes." |
| 5 | 0:55-1:30 | Say **"What's at risk this week?"**, then **"Why?"**, then the talk-back sentence that **Load demo data** showed you (it has the real keys, like "I finished HB-5, HB-8 is blocked on legal, I'll pick up HB-2 today"), then **"yes"**. Team pulse rows flash | VO (short, between answers): "Risk Radar gives three risks and one fix each. Why? It shows the rule and the issues that prove it. And I can just talk: three updates in one sentence, read back before anything changes." |
| 6 | 1:30-1:50 | Architecture image | VO: "Rovo and Atlassian's agents can already change Jira from typed commands. HeyBrief closes the loop by voice: it answers out loud, reads back the exact change, waits for your spoken yes, and gives you Undo. One Forge engine, 199 tests, running as you, so Jira enforces your permissions." |
| 7 | 1:50-2:10 | Rovo chat: "What's on my plate today?" then one change and its yes | VO: "The same engine is a Rovo agent, with the same yes gate." |
| 8 | 2:10-2:30 | Claude with the HeyBrief MCP server: ask "What's at risk in HB?", then confirm one change | VO: "And it's an Atlassian MCP server, so Claude, Cursor or any MCP client gets the same tools, with the same yes." |
| 9 | 2:30-2:45 | Voice page: switch to **عربي** (page flips right to left) and ask "ما هي المخاطر؟", then FR for one line | VO: "In English, French and Arabic. HeyBrief: talk to Jira, and Jira changes." End on the logo/page. |

Pilot number: if the pilot is done before recording, add one line in shot 6: "In a pilot with N people, updates took X seconds by voice versus Y by clicking." Use the exact numbers from PILOT_KIT.md, no rounding up.

## Checklist after recording

- Length under 2:45 (hard limit 5:00).
- Upload to YouTube as **Public** (not Unlisted). Title: "HeyBrief: talk to Jira, and Jira changes (Codegeist 2026)".
- Paste the URL in the thread; I put it in the Devpost form.
