# Security design

- **No write without a human yes.** Every write is proposed first, read back, and stored as a pending action (2-minute expiry checked against the clock, bound to the accountId, one per user). Anything other than a clear yes cancels it. Execution is claimed with an atomic KVS `FAIL_IF_EXISTS` write, so a retried or doubled "yes" runs once.
- **Permission re-check at execute time.** Permissions are checked when planning and again when running, so a change in the 2-minute window is respected.
- **Everything runs as the user.** The voice page, gadget, Rovo actions and MCP tools all call Jira with `asUser()`, so Jira enforces the user's own permissions. No web trigger is deployed.
- **Voice stays in the browser.** Speech-to-text and text-to-speech run in the user's browser; HeyBrief receives text only, never audio.
- **No hallucinated tickets.** Risk Radar and talk-back are deterministic rules. The LLM only rewords template speech, and `guardPhrase` drops any output that names an issue key not in the facts or runs over 60 words.
- **Audit trail.** Every write adds a comment naming HeyBrief and the confirming user. The drive receipt keeps what was heard and done for 7 days, with undo for transitions, flags and assignments.
- **JQL safety.** Only validated project and issue keys reach JQL; free text never does.
- **No egress.** No external hosts; data stays on Atlassian.

Known limit: in Rovo and MCP the yes is relayed by the agent. The agent prompt forbids confirming on the user's behalf and requires the confirmation id plus the user's verbatim reply, but a chat agent can still misbehave. The voice page and the gadget are hard gates: Yes is a button press or the user's own spoken yes, bound to the pending action's id.

Roadmap (not deployed): the Siri door would run `asApp()`. Its design is already coded and tested: 32-byte tokens shown once and stored only as SHA-256 hashes, 20 requests a minute per token, and every read and write filtered through a fail-closed permission check for the paired user.
