# HeyBrief privacy

HeyBrief is a Forge app for Jira (and optionally Confluence). It runs entirely on Atlassian Forge. We run no server of our own.

**What it reads.** Jira issues, statuses, assignees and links, and Confluence pages when you ask it to search. Every read runs as the signed-in user, so Jira's permissions apply.

**What it stores.** Kept in Forge storage on Atlassian's platform, keyed by your Atlassian account ID:
- the change you are being asked to confirm (it expires after 2 minutes),
- your receipts, which make Undo possible,
- HeyBrief settings (chosen projects, optional Confluence space key, and whether outside incidents are on).

Nothing is copied outside Atlassian. Uninstalling the app deletes its Forge storage.

**Speech.** Voice recognition and spoken answers use your browser's built-in speech features. HeyBrief only receives the text.

**AI.** When Forge LLM is enabled, HeyBrief may send the facts of an answer (issue keys, summaries, statuses) to Atlassian's Forge LLM so it can reword them. This stays inside Atlassian. With the LLM off, HeyBrief uses its own built-in wording.

**Outside incidents (off by default).** If an admin turns it on, HeyBrief reads public status pages (for example GitHub or Cloudflare). It sends them no Jira data.

**Contact.** Open an issue at https://github.com/ashrefbouden/heybrief/issues .
