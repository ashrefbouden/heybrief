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
  receipts: (lang) => call<ReceiptView[]>('getReceipts', { lang }),
  undo: (receiptId) => call<{ ok: boolean }>('undo', { receiptId }),
  alerts: (lang) => call<Turn>('alerts', { lang }),
};

void view.theme?.enable?.().catch(() => undefined);
// The browser's speech recognition may be refused inside the Forge iframe; the console then hides the mic and keeps typing.
mountConsole(document.getElementById('app')!, backend, webSpeechListener());
