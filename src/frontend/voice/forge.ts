// Entry for the Forge Custom UI page "HeyBrief" in Jira. Talks to the resolvers in src/doors/resolvers.ts.

import { invoke, view } from '@forge/bridge';
import type { ReceiptView } from '../../engine/receipt';
import { webSpeechListener } from './listeners';
import type { Backend, BoardIssue, Turn } from './types';
import { mountConsole } from './ui';

const call = async <T>(key: string, payload?: Record<string, unknown>) => (await invoke<T>(key, payload as any)) as T;

const backend: Backend = {
  label: 'Live Jira',
  ask: (text, { lang, minutes }) => call<Turn>('ask', { text, lang, minutes }),
  decide: (pendingId, yes, lang) => call<Turn>('decide', { pendingId, yes, lang }),
  board: () => call<BoardIssue[]>('board'),
  receipts: () => call<ReceiptView[]>('getReceipts'),
  undo: (receiptId) => call<{ ok: boolean }>('undo', { receiptId }),
};

void view.theme?.enable?.().catch(() => undefined);
// The browser's speech recognition may be refused inside the Forge iframe; the console then hides the mic and keeps typing.
mountConsole(document.getElementById('app')!, backend, webSpeechListener(), {
  subtitle: 'Talk to Jira, and Jira changes.',
  chips: [
    { label: 'Brief me', text: 'Brief me' },
    { label: "What's at risk?", text: "What's at risk this week?" },
    { label: 'Why?', text: 'Why?' },
  ],
});
