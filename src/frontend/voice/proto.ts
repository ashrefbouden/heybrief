// Entry for the in-browser prototype (published as a claude.ai Artifact with the dictation capability).

import { dictationListener, webSpeechListener } from './listeners';
import { localBackend } from './local';
import { mountConsole } from './ui';
import type { Listener } from './types';

// Story chips after the built-in ones: the judge script's talk-back lines.
const CHIPS = [
  { label: 'Talk-back update', text: "I finished MP-12, MP-15 is blocked on legal, I'll pick up MP-9 today" },
  { label: 'En français', text: "J'ai terminé MP-12, MP-15 est bloqué par le juridique", lang: 'fr' as const },
  { label: 'بالعربية', text: 'ما هي المخاطر هذا الأسبوع؟', lang: 'ar' as const },
];

const root = document.getElementById('app')!;
const backend = localBackend();
const opts = { chips: CHIPS };
type ClaudeRuntime = { use?: (name: string) => Promise<unknown> };
const runtime = (window as unknown as { claude?: ClaudeRuntime }).claude;
// Only the claude.ai artifact runtime has claude.use(). Other hosts may define window.claude without it.
const useCapability = typeof runtime?.use === 'function' ? runtime.use.bind(runtime) : undefined;

// Inside claude.ai the frame refuses the browser's own speech API, so typing first, then platform dictation
// if this view offers it. Opened as a plain file (or anywhere else), use the browser's speech recognition.
mountConsole(root, backend, useCapability ? null : webSpeechListener(), opts);
if (useCapability) {
  Promise.resolve()
    .then(() => useCapability('dictation'))
    .then((d) => {
      const l: Listener | null = dictationListener((d ?? null) as Parameters<typeof dictationListener>[0]);
      if (l) mountConsole(root, backend, l, opts);
    })
    .catch(() => undefined);
}
