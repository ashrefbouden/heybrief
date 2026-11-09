// Siri door: a dynamic web trigger the iOS Shortcut POSTs to.
//   POST <webtrigger url>
//   Authorization: Bearer hb_...
//   {"text": "brief me", "lang": "en-US", "etaMinutes": 11}
// -> {"speech": "...", "lang": "en", "expectReply": true}
// expectReply tells the Shortcut to "Dictate Text" again and send the answer (the "yes" turn).

import type { WebTriggerRequest, WebTriggerResponse } from '@forge/api';
import { authenticate, parseSiriBody } from '../engine/siri/auth';
import { forgeStore } from '../forge/store';
import { engineFor } from './wiring';

const json = (statusCode: number, body: unknown): WebTriggerResponse => ({
  statusCode,
  headers: { 'Content-Type': ['application/json'], 'Cache-Control': ['no-store'] },
  body: JSON.stringify(body),
});

export async function siriHandler(req: WebTriggerRequest): Promise<WebTriggerResponse> {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const clock = { now: () => new Date() };
  const auth = await authenticate(forgeStore, clock, req.headers);
  if (!auth.ok)
    return json(auth.status, {
      error: auth.error,
      speech:
        auth.status === 429
          ? 'Too many requests. Try again in a minute.'
          : 'This phone is not paired. Open HeyBrief settings in Jira.',
    });

  const body = parseSiriBody(req.body);
  if (!body) return json(400, { error: 'bad request', speech: "I didn't get that." });

  try {
    const { hb } = await engineFor({ kind: 'app', accountId: auth.accountId });
    const a = await hb.route(auth.accountId, body.text, { lang: body.lang, etaMinutes: body.etaMinutes });
    return json(200, { speech: a.speech, lang: a.lang, expectReply: a.expectReply });
  } catch (e) {
    // Never leak internals to the phone; the log has the detail.
    console.error('siri handler failed', e instanceof Error ? e.message : e);
    return json(200, { speech: 'HeyBrief could not reach Jira just now. Try again in a moment.', expectReply: false });
  }
}
