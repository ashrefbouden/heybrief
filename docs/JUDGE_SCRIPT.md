# HeyBrief: judge test script (about 5 minutes)

HeyBrief runs inside Jira on Atlassian Forge. Every change waits for your yes, and every change can be undone.

## Before you start (one time, about 1 minute)

1. In Jira, open **Settings (gear) > Personal settings > HeyBrief**.
2. Under **Demo data**, enter an empty test project key and click **Load demo data**. This creates 14 labelled issues with three built-in risks. The page shows the exact issue keys it created; the steps below use the demo story's numbers (`-12`, `-15`, `-9`, `-42`).
3. Optional: add the **HeyBrief receipt** gadget to a Jira dashboard.

Use Microsoft Edge or Chrome for the best voices. Typing works everywhere: every step below can be typed instead of spoken.

## The script

Open **Apps > HeyBrief** in the Jira top bar. Allow the microphone if asked.

| # | Say or type | What you should see |
|---|---|---|
| 1 | "Brief me" | A spoken brief under 60 words: your issues ranked by urgency, who is waiting on you, and one decision about the top risk. Every item names its issue key. |
| 2 | "What's at risk this week?" | Three risks. The top one is the issue blocked 6 days that holds up two others, labelled **confirmed**. Overload and due-soon risks are labelled as **estimates**. A yes card proposes one fix and lists exactly what it would change. |
| 3 | "Why?" | The rule that fired and the issues that prove it. The proposed fix stays open. |
| 4 | Click **Yes, do it** (or say "yes") | A follow-up issue is created and linked. The Receipt shows it, with Undo. |
| 5 | "I finished -12, -15 is blocked on legal, I'll pick up -9 today" (with your project key) | The yes card lists six changes: one Done, one Blocked plus flag, the owner notified, one In Progress, and a Confluence standup note. Nothing has changed in Jira yet. |
| 6 | Say "yes" | Team pulse updates live: changed rows flash. Each issue gets an audit comment naming you. |
| 7 | Click **Undo** on that receipt | The statuses and the flag go back. Undo on step 4's receipt deletes the follow-up it created. Audit comments stay. |
| 8 | Switch to **FR** or **عربي** and ask "Quels risques ?" or "ما هي المخاطر؟" | The answer, the yes card and the whole page switch language. Arabic switches the page to right to left. |
| 9 | In another tab, create an unassigned **Highest** priority issue named "Checkout API down in production". Come back and wait up to a minute. | A Heads-up banner and chime, spoken once, with one proposed action (take it) waiting for your yes. |

## Also try

- **Rovo chat:** open Rovo, pick the **HeyBrief** agent, and ask "What's on my plate today?". The same yes gate applies: Rovo shows the proposed changes and waits for your own yes.
- **Any MCP client:** the same eight actions are exposed as MCP tools.
- **Safety:** say something other than yes while a change is waiting. It is cancelled and nothing changes. A proposal also expires after 2 minutes.

## Without a Jira site

Open `dist/heybrief-voice.html` in Chrome or Edge (build it with `npm run build`). It runs the real engine over a simulated Jira project, with the same story and buttons to reset the demo or simulate an outage.
