// Speech-to-text adapters. Both return null when the view cannot listen, so the UI falls back to typing.

import type { Lang, Listener } from './types';

const BCP47: Record<Lang, string> = { en: 'en-US', fr: 'fr-FR', ar: 'ar-TN' };

/** Minimal shape of the claude.ai artifact dictation namespace (contract 0.2.74). */
interface Dictation {
  start(o?: { language?: string }): Promise<void>;
  stop(): Promise<void>;
  onPartial(h: (e: { text: string }) => void): () => void;
  onFinal(h: (e: { text: string }) => void): () => void;
  onState(h: (e: { state: string; reason?: string }) => void): () => void;
}

export function dictationListener(d: Dictation | null): Listener | null {
  if (!d) return null;
  let subs: Array<() => void> = [];
  const drop = () => {
    subs.forEach((u) => u());
    subs = [];
  };
  return {
    start(lang, on) {
      drop();
      subs.push(
        d.onPartial((e) => on.partial(e.text)),
        d.onFinal((e) => on.final(e.text)),
        d.onState((e) => {
          if (e.state === 'idle') {
            drop();
            on.end(e.reason);
          }
        }),
      );
      // Called synchronously from the click, as the platform requires.
      return d.start({ language: BCP47[lang] }).then(
        () => true,
        (err: { code?: string }) => {
          drop();
          on.end(err?.code ?? 'upstream_error');
          return false;
        },
      );
    },
    async stop() {
      await d.stop().catch(() => undefined);
    },
  };
}

/** Browser Web Speech API (Chrome, Edge). In a sandboxed iframe it may be refused; then end() says not_granted. */
export function webSpeechListener(): Listener | null {
  const W = window as unknown as { SpeechRecognition?: any; webkitSpeechRecognition?: any };
  const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
  if (!Ctor) return null;
  let rec: any;
  return {
    start(lang, on) {
      rec = new Ctor();
      rec.lang = BCP47[lang];
      rec.interimResults = true;
      rec.continuous = false;
      let ended = false;
      const finish = (reason: string) => {
        if (ended) return;
        ended = true;
        on.end(reason);
      };
      rec.onresult = (e: any) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) on.final(' ' + r[0].transcript);
          else interim += r[0].transcript;
        }
        on.partial(interim);
      };
      rec.onerror = (e: any) =>
        finish(
          e.error === 'not-allowed' || e.error === 'service-not-allowed'
            ? 'not_granted'
            : e.error === 'no-speech'
              ? 'stopped'
              : 'upstream_error',
        );
      rec.onend = () => finish('stopped');
      try {
        rec.start();
        return Promise.resolve(true);
      } catch {
        finish('upstream_error');
        return Promise.resolve(false);
      }
    },
    async stop() {
      try {
        rec?.stop();
      } catch {
        /* already stopped */
      }
    },
  };
}
