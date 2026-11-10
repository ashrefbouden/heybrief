# PC back: setup checklist

About 90 minutes on your side. Do the steps in order, and paste me the output of any step marked **send me**. Windows PowerShell commands are shown. Anything in `<angle brackets>` is yours to fill in.

## 0. Check your tools (5 min)

```powershell
node --version        # need v22.x. If not: install Node 22 LTS from nodejs.org, reopen PowerShell
git --version
npm install -g @forge/cli@latest
forge --version       # 15.x or newer
```

## 1. Put the old MVP on GitHub, without secrets (15 min)

On github.com, create a **private** repo named `jira-voice-assistant` with no README. Then:

```powershell
cd F:\jira-voice-assistant
git status                           # if "not a git repository", run: git init -b main
type .gitignore                      # it must list .env (and .dev.vars if you have one)
```

If `.env` isn't listed:

```powershell
Add-Content .gitignore "`n.env`n.env.*`n.dev.vars`nnode_modules/"
```

Then:

```powershell
git add -A
git status                           # STOP if you see .env, .dev.vars or any key file in the list
git commit -m "MVP snapshot before Forge port"
git remote add origin https://github.com/<you>/jira-voice-assistant.git
git push -u origin main
```

## 2. Create the HeyBrief repo (5 min)

On github.com, create a **private** repo named `heybrief`. Leave it empty: no README, no .gitignore, no license.

Then connect GitHub to Claude: <https://claude.ai/connect-github>, and allow access to both repos.

**Send me** both repo names. I'll attach them, push the cloud code to `heybrief`, and start merging the MVP into it.

## 3. Log in to Forge (10 min)

1. Create an API token at <https://id.atlassian.com/manage-profile/security/api-tokens>. Name it "forge cli" and copy it.
2. Run:

```powershell
forge login            # your Atlassian email, then paste the token
forge whoami           # should print your name
```

## 4. Make the demo site (10 min)

```powershell
forge site provision
```

Pick Jira + Confluence if it asks. Wait for the email, open the site once in the browser, and check that Rovo shows in the top bar.

**Send me** the site URL (`something.atlassian.net`).

The site lasts 90 days, until about Feb 7. Judging ends Feb 3, so that's tight. Write the expiry date down.

## 5. Clone, register, deploy (20 min)

After I've pushed to `heybrief` (step 2):

```powershell
cd F:\
git clone https://github.com/<you>/heybrief.git
cd heybrief
npm install
npm run check                       # typecheck + tests + builds the voice page; must be all green
forge register --accept-terms       # writes the real app id into manifest.yml
git add manifest.yml; git commit -m "Register Forge app"; git push
forge deploy
forge install --site <site>.atlassian.net --product jira --confirm-scopes
forge install --site <site>.atlassian.net --product confluence --confirm-scopes
```

If `forge deploy` complains about imports, send me the full output. Checking how the bundler handles our imports is one of the M0 checks.

## 6. Smoke test (20 min)

1. In Jira, create a project with key `MP` (Scrum, company-managed if it offers the choice). Create a Confluence space with key `MP`.
2. Open **your profile > Personal settings > HeyBrief**. Type `MP` under Demo data and click **Load demo data**. **Send me** what it shows.
3. Open **Apps > HeyBrief** in the Jira top bar (Chrome). Click the mic and allow it. Say `What's at risk this week?`, then `why?`, then click **Yes, do it**. If the mic doesn't appear, type instead and tell me.
4. Say the talk-back line it gave you in step 2, then say `yes`. Watch the board on the right change, then check the issues in Jira.
5. Try **Undo** on the receipt in the page. Then add the **HeyBrief receipt** gadget to a dashboard and check it shows the same receipt.
6. Open Rovo, pick the **HeyBrief** agent, and repeat step 3 in chat.
7. Run `forge logs` and **send me** anything red.

## 7. The five checks I can't do from the cloud

Run this and **send me** the output:

```powershell
forge logs --since 15m
```

That covers four of the five:

- **Mic in the Jira page:** whether Chrome allows speech recognition inside the Forge page. If it doesn't, we demo with typing plus Windows dictation (Win+H) and I'll look at a fix.
- **Who the action thinks you are:** if Rovo says "No user context", tell me.
- **Blocker link direction:** in Jira, open the demo blocked issue. It should say "blocks" the two login issues.
- **Flagged field:** the blocked issue should show the red flag.

The fifth is whether Forge AI is turned on for the site. If answers sound robotic but correct, it's off. That's fine, because the templates still work.

## 8. Siri

Moved to the roadmap. Nothing to do. The old steps are in [ROADMAP_SIRI.md](ROADMAP_SIRI.md).

## Don't

- Don't commit `.env` or tokens.
- Don't submit on Devpost. That's the Nov 30 step, and only on your yes.
