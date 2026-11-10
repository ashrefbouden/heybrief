> **Roadmap, not in v1 (decided Nov 10, 2026).** v1 ships voice in the browser: the HeyBrief page in Jira, plus Rovo and MCP. This page is kept for the Siri / CarPlay door after Codegeist. Its server code (`src/doors/siri.ts`, `src/engine/siri/auth.ts`, `src/engine/permissions.ts`) is tested but not exported or in the manifest. To turn it on: export `siriHandler` from `src/index.ts`, add the `siri` web trigger and `siri-fn` back to `manifest.yml`, and restore the pairing section in `src/frontend/settings.tsx` (git history, commit d5d1338).

# Build the HeyBrief Siri Shortcut

This takes about 25 minutes on the iPhone, using the Shortcuts app (iOS 17 or newer). You'll end up with:

- "Hey Siri, HeyBrief" opens a two-way voice conversation.
- An automation starts the brief when the phone connects to CarPlay.

Before you start, open Jira on any device, go to **Profile > Personal settings > HeyBrief > Pair a phone**, and keep the page open. It shows two things once: the **web address** and the **token**.

> The screenshot notes below say what you should see on screen. Use them as a check, not a pixel guide; menus move a little between iOS versions.

---

## Part 1: the "HeyBrief" shortcut

1. **Create it.** Open Shortcuts and tap **+** (top right). Tap the title at the top, rename it to **HeyBrief**, and pick an icon.
   *Screen: an empty shortcut called "HeyBrief", with a search bar at the bottom.*

2. **Accept input from automations.** Tap the **ⓘ** (bottom bar) and turn on **Show in Share Sheet**. That adds "Receive *Any* input from Share Sheet" at the top. Tap **Any**, choose **Text** only, and set "If there's no input" to **Continue**.
   *Screen: the first action reads "Receive Text input from Share Sheet, If there's no input: Continue".*

3. **Store the address.** Add **Text** and paste the web address. Long-press it, choose **Rename**, and call it `URL`. *(Rename is under the action's ▸ menu on some versions. Otherwise add **Set Variable** "URL" right after it.)*

4. **Store the token.** Add **Text**, type `Bearer `, and paste the token after the space, so it reads `Bearer hb_…`. Then **Set Variable** `Auth`.
   *Screen: two Text blocks, one holding https://…atlassian-dev.net/…, one holding Bearer hb_…*

5. **Get the drive time (optional, for the drive-sized brief).**
   - Add **Get Travel Time** and set the destination to your **Work** address. Leave "from Current Location" and "Driving".
   - Add **Get Numbers from Input**, with Travel Time as its input.
   - **Set Variable** `ETA`.

   If it gives something odd, skip this step. HeyBrief then gives a standard 3-item brief.

6. **What to say.** Add **If**, with input **Shortcut Input** and condition **has any value**.
   - Inside **If**: **Set Variable** `Said` to Shortcut Input.
   - Inside **Otherwise**: add **Dictate Text** (language: English, stop listening: **After Pause**), then **Set Variable** `Said` to Dictated Text.

   *Screen: an If / Otherwise / End If block, with a microphone action in the Otherwise half.*

7. **Call HeyBrief.** Add **Get Contents of URL** with the `URL` variable, tap **▸** (Show More), and set:
   - Method: **POST**
   - Headers: add `Authorization` = variable `Auth`, and add `Content-Type` = `application/json`
   - Request Body: **JSON**, with fields:
     - `text` (Text) = variable `Said`
     - `lang` (Text) = `en`
     - `etaMinutes` (Number) = variable `ETA`, or leave it out if you skipped step 5

   *Screen: "Get contents of URL" expanded, showing POST, 2 headers and 3 JSON fields.*

8. **Speak the answer.** Add **Get Dictionary Value**: key `speech` in Contents of URL. Then add **Speak Text** with Dictionary Value (Rate: a little below default; Language: English).

9. **The "yes" turn (two-way talk).** Add **Repeat** with 3 times. Inside it:
   1. **Get Dictionary Value** `expectReply` in Contents of URL.
   2. **If** Dictionary Value **is** `1`. Shortcuts shows true as 1. If that never fires, try `true`.
      - **Dictate Text** (After Pause), then **Set Variable** `Said`
      - **Get Contents of URL**: long-press the one from step 7 and choose **Duplicate**, then drag the copy here
      - **Get Dictionary Value** `speech`, then **Speak Text**
   3. **End If**

   *Screen: a Repeat block containing an If block with a microphone, a URL call and a speaker.*

   This lets the conversation go "brief me", then "…want me to create a follow-up?", then "yes", then "Done, MP-901", then another question, for up to 3 follow-ups.

10. **Test it.** Tap ▶. Say "brief me". You should hear "You have N minutes: …".

    If you hear "This phone is not paired", the token is wrong, so redo step 4. If you hear "Too many requests", wait a minute.

11. **Siri phrase.** The shortcut's name is the phrase. Say **"Hey Siri, HeyBrief"**.

## Part 2: French and Arabic

Duplicate the shortcut twice (long-press it, then **Duplicate**), and rename the copies:

- **HeyBrief FR**: in each Dictate Text action, set Language to French (France). Set the JSON `lang` field to `fr`. Set Speak Text's Language to French.
- **HeyBrief AR**: set those three to Arabic. Siri phrase: "Hey Siri, HeyBrief AR".

HeyBrief detects the language from the words too, but setting `lang` makes short answers like "oui" or "نعم" reliable.

## Part 3: start the brief when CarPlay connects

1. In Shortcuts, open the **Automation** tab, tap **+**, and choose **CarPlay**.
2. Choose **Connects**, then **Run Immediately**, and turn **Notify When Run** off.
3. Next, choose **HeyBrief**.
4. Tap the shortcut block, then **Input**, and enter the text `brief me`.

*Screen: "When CarPlay connects, Run HeyBrief with brief me".*

## Safety and the video

- The first line HeyBrief speaks in the car is always under 60 words. You never need to look at the phone.
- **Film parked.** Put "Parked. Never film while driving." on screen.

## Troubleshooting

| What you hear or see | Fix |
|---|---|
| "This phone is not paired" | The token is wrong or was rotated. Pair again in settings and update step 4. |
| "Too many requests" | Over 20 calls a minute. Wait. |
| "Jira is slow right now" | Retry once. If you'd just said yes, check the drive receipt gadget first. |
| Silence, or a red error in Shortcuts | The URL is wrong. Copy it again from settings. |
| The yes turn never happens | In step 9, compare `expectReply` to `true` instead of `1`. |
