// The HeyBrief voice console: talk (or type), hear the answer, confirm writes, watch the board change.
// Plain DOM so the same file runs in the browser prototype and in a Forge Custom UI page.
// Every string from the backend goes in with textContent: nothing is parsed as HTML.

import type { Backend, BoardIssue, Lang, Listener, ReceiptView, Turn } from './types';

export interface ConsoleOptions {
  /** Suggested phrases shown as chips. */
  chips: Array<{ label: string; text: string }>;
  /** Short line under the title. */
  subtitle: string;
}

const CONFIRM_MS = 120_000;
const SILENCE_MS = 1400;
const VOICE_LANG: Record<Lang, string> = { en: 'en-US', fr: 'fr-FR', ar: 'ar-SA' };

type Who = 'me' | 'hb' | 'sys';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function mountConsole(root: HTMLElement, backend: Backend, listener: Listener | null, opts: ConsoleOptions) {
  // ---------- state ----------
  let lang: Lang | undefined;
  let minutes: number | undefined;
  let speakOn = true;
  let busy = false;
  let listening = false;
  let pending: { id: string; deadline: number; lang: Lang } | undefined;
  let lastBoard = new Map<string, string>();
  let silenceTimer: ReturnType<typeof setTimeout> | undefined;
  let countdown: ReturnType<typeof setInterval> | undefined;

  // ---------- layout ----------
  root.replaceChildren();
  const app = el('div', 'hb');
  const head = el('header', 'hb-head');
  const brand = el('div', 'hb-brand');
  brand.append(el('h1', '', 'HeyBrief'), el('p', 'hb-sub', opts.subtitle));
  const badge = el('span', 'hb-badge', backend.label);
  const controls = el('div', 'hb-controls');

  const langSel = el('select', 'hb-select');
  langSel.setAttribute('aria-label', 'Language');
  for (const [v, t] of [
    ['', 'Auto language'],
    ['en', 'English'],
    ['fr', 'Français'],
    ['ar', 'العربية'],
  ]) {
    const o = el('option', '', t);
    o.value = v;
    langSel.append(o);
  }
  langSel.onchange = () => (lang = (langSel.value || undefined) as Lang | undefined);

  const minSel = el('select', 'hb-select');
  minSel.setAttribute('aria-label', 'Time you have');
  for (const [v, t] of [
    ['', 'Standard brief'],
    ['4', '4 min drive'],
    ['12', '12 min drive'],
    ['25', '25 min drive'],
  ]) {
    const o = el('option', '', t);
    o.value = v;
    minSel.append(o);
  }
  minSel.onchange = () => (minutes = minSel.value ? Number(minSel.value) : undefined);

  const speakBtn = el('button', 'hb-toggle', 'Voice on');
  speakBtn.type = 'button';
  speakBtn.setAttribute('aria-pressed', 'true');
  speakBtn.onclick = () => {
    speakOn = !speakOn;
    speakBtn.textContent = speakOn ? 'Voice on' : 'Voice off';
    speakBtn.setAttribute('aria-pressed', String(speakOn));
    if (!speakOn) window.speechSynthesis?.cancel();
  };
  controls.append(langSel, minSel, speakBtn);
  if (backend.reset) {
    const resetBtn = el('button', 'hb-toggle', 'Reset demo');
    resetBtn.type = 'button';
    resetBtn.onclick = async () => {
      await backend.reset!();
      log.replaceChildren();
      clearPending();
      lastBoard = new Map();
      say('sys', 'Demo reset. Same story, fresh board.');
      await refresh();
    };
    controls.append(resetBtn);
  }
  head.append(brand, badge, controls);

  const main = el('main', 'hb-main');
  const convo = el('section', 'hb-convo');
  convo.setAttribute('aria-label', 'Conversation');
  const log = el('div', 'hb-log');
  log.setAttribute('role', 'log');
  log.setAttribute('aria-live', 'polite');

  const confirmCard = el('div', 'hb-confirm');
  confirmCard.hidden = true;
  const confirmText = el('p', 'hb-confirm-text', 'Nothing changes until you say yes.');
  const confirmTimer = el('span', 'hb-confirm-timer');
  const yesBtn = el('button', 'hb-btn hb-btn-primary', 'Yes, do it');
  const noBtn = el('button', 'hb-btn', 'Cancel');
  yesBtn.type = noBtn.type = 'button';
  const confirmRow = el('div', 'hb-confirm-row');
  confirmRow.append(yesBtn, noBtn, confirmTimer);
  confirmCard.append(confirmText, confirmRow);
  yesBtn.onclick = () => decide(true);
  noBtn.onclick = () => decide(false);

  const chips = el('div', 'hb-chips');
  for (const c of opts.chips) {
    const b = el('button', 'hb-chip', c.label);
    b.type = 'button';
    b.title = c.text;
    b.onclick = () => send(c.text);
    chips.append(b);
  }

  const bar = el('form', 'hb-bar');
  const mic = el('button', 'hb-mic');
  mic.type = 'button';
  mic.setAttribute('aria-label', 'Talk');
  mic.append(micIcon());
  const input = el('input', 'hb-input');
  input.type = 'text';
  input.placeholder = listener ? 'Tap the mic and talk, or type here' : 'Type what you would say';
  input.setAttribute('aria-label', 'What you say');
  input.dir = 'auto';
  input.maxLength = 500;
  const sendBtn = el('button', 'hb-btn hb-btn-primary', 'Send');
  sendBtn.type = 'submit';
  bar.append(mic, input, sendBtn);
  bar.onsubmit = (e) => {
    e.preventDefault();
    send(input.value);
  };
  if (!listener) mic.hidden = true;
  const hint = el('p', 'hb-hint');
  hint.textContent = listener
    ? 'Tap the mic, talk, then pause. HeyBrief sends when you stop talking.'
    : 'Voice input is not available in this browser. Typing works the same way.';

  convo.append(log, confirmCard, chips, bar, hint);

  const side = el('aside', 'hb-side');
  const boardHead = el('h2', '', 'Jira board');
  const board = el('div', 'hb-board');
  const recHead = el('h2', '', 'Drive receipt');
  const receipts = el('div', 'hb-receipts');
  side.append(boardHead, board, recHead, receipts);

  main.append(convo, side);
  app.append(head, main);
  root.append(app);

  // ---------- conversation ----------
  function say(who: Who, text: string, l?: Lang) {
    const b = el('div', `hb-msg hb-${who}`);
    b.dir = l === 'ar' ? 'rtl' : 'auto';
    if (l) b.lang = l;
    b.textContent = text;
    log.append(b);
    log.scrollTop = log.scrollHeight;
  }

  function speak(text: string, l: Lang) {
    const synth = window.speechSynthesis;
    if (!speakOn || !synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = VOICE_LANG[l];
    const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith(l));
    if (voice) u.voice = voice;
    u.rate = 1.02;
    synth.speak(u);
  }

  function setBusy(b: boolean) {
    busy = b;
    app.classList.toggle('is-busy', b);
    sendBtn.disabled = yesBtn.disabled = noBtn.disabled = b;
  }

  async function send(raw: string) {
    const text = raw.replace(/\s+/g, ' ').trim();
    if (!text || busy) return;
    input.value = '';
    say('me', text);
    setBusy(true);
    try {
      show(await backend.ask(text, { lang, minutes }));
    } catch {
      say('sys', 'Something went wrong. Nothing was changed.');
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  async function decide(yes: boolean) {
    if (!pending || busy) return;
    const p = pending;
    say('me', yes ? 'Yes' : 'Cancel');
    setBusy(true);
    try {
      show(await backend.decide(p.id, yes, p.lang));
    } catch {
      say('sys', 'Something went wrong. Nothing was changed.');
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  function show(t: Turn) {
    say('hb', t.speech, t.lang);
    speak(t.speech, t.lang);
    if (t.pendingId) setPending(t.pendingId, t.lang);
    else clearPending();
  }

  function setPending(id: string, l: Lang) {
    pending = { id, deadline: Date.now() + CONFIRM_MS, lang: l };
    confirmCard.hidden = false;
    tick();
    if (countdown) clearInterval(countdown);
    countdown = setInterval(tick, 1000);
  }

  function clearPending() {
    pending = undefined;
    confirmCard.hidden = true;
    if (countdown) clearInterval(countdown);
    countdown = undefined;
  }

  function tick() {
    if (!pending) return;
    const left = Math.max(0, Math.round((pending.deadline - Date.now()) / 1000));
    confirmTimer.textContent = left ? `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Expired';
    if (!left) {
      clearPending();
      say('sys', 'The proposal expired. Nothing was changed.');
    }
  }

  // ---------- voice in ----------
  mic.onclick = () => {
    if (!listener) return;
    if (listening) {
      void finishListening();
      return;
    }
    if (busy) return;
    window.speechSynthesis?.cancel();
    const before = input.value.trim();
    let settled = before;
    listening = true;
    mic.classList.add('is-on');
    mic.setAttribute('aria-label', 'Stop and send');
    // start() must run synchronously inside this click.
    const started = listener.start(lang ?? pending?.lang ?? 'en', {
      partial(text) {
        input.value = (settled + (text ? ' ' + text : '')).trim();
        if (text) armSilence(false);
      },
      final(text) {
        settled = (settled + text).trim();
        input.value = settled;
        armSilence(true);
      },
      end(reason) {
        if (!listening) return; // finishListening() is already sending
        stopUi();
        const benign = !reason || ['stopped', 'viewer_stopped', 'hidden'].includes(reason);
        if (benign) {
          if (input.value.trim()) void send(input.value);
          return;
        }
        say('sys', micProblem(reason));
        if (reason === 'unavailable' || reason === 'not_granted') mic.hidden = true;
      },
    });
    void started.then((ok) => {
      if (!ok) stopUi();
    });
  };

  function armSilence(on: boolean) {
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = on ? setTimeout(() => void finishListening(), SILENCE_MS) : undefined;
  }

  async function finishListening() {
    if (!listening) return;
    stopUi();
    await listener?.stop();
    if (input.value.trim()) await send(input.value);
  }

  function stopUi() {
    listening = false;
    armSilence(false);
    mic.classList.remove('is-on');
    mic.setAttribute('aria-label', 'Talk');
  }

  // ---------- board + receipts ----------
  async function refresh() {
    const [issues, recs] = await Promise.all([backend.board().catch(() => []), backend.receipts().catch(() => [])]);
    renderBoard(issues);
    renderReceipts(recs);
  }

  function renderBoard(issues: BoardIssue[]) {
    const changed = new Set<string>();
    const next = new Map<string, string>();
    for (const i of issues) {
      const sig = [i.status, i.assignee ?? '', i.flagged, i.blockedBy.join(',')].join('|');
      next.set(i.key, sig);
      if (lastBoard.size && lastBoard.get(i.key) !== sig) changed.add(i.key);
    }
    lastBoard = next;
    const cols: Array<[string, (i: BoardIssue) => boolean]> = [
      ['To do', (i) => i.statusCategory === 'todo'],
      ['In progress', (i) => i.statusCategory === 'inprogress'],
      ['Done', (i) => i.statusCategory === 'done'],
    ];
    board.replaceChildren();
    for (const [title, pick] of cols) {
      const col = el('div', 'hb-col');
      const list = issues.filter(pick);
      col.append(el('h3', '', `${title} · ${list.length}`));
      for (const i of list) col.append(card(i, changed.has(i.key)));
      board.append(col);
    }
  }

  function card(i: BoardIssue, changed: boolean) {
    const c = el('div', 'hb-card' + (changed ? ' is-changed' : ''));
    const top = el('div', 'hb-card-top');
    top.append(el('span', 'hb-key', i.key));
    if (i.status === 'Blocked' || i.flagged)
      top.append(el('span', 'hb-tag hb-tag-red', i.status === 'Blocked' ? 'Blocked' : 'Flagged'));
    if (i.dueDate) top.append(el('span', 'hb-tag', `Due ${i.dueDate.slice(5)}`));
    c.append(top, el('div', 'hb-sum', i.summary));
    const meta = [i.assignee ?? 'Unassigned'];
    if (i.blockedBy.length) meta.push(`waits on ${i.blockedBy.join(', ')}`);
    if (i.blocks.length) meta.push(`blocks ${i.blocks.join(', ')}`);
    c.append(el('div', 'hb-meta', meta.join(' · ')));
    return c;
  }

  function renderReceipts(recs: ReceiptView[]) {
    receipts.replaceChildren();
    if (!recs.length) {
      receipts.append(el('p', 'hb-empty', 'Every change you confirm shows up here, with undo.'));
      return;
    }
    for (const r of recs.slice(0, 6)) {
      const box = el('div', 'hb-rec' + (r.undone ? ' is-undone' : ''));
      const top = el('div', 'hb-rec-top');
      top.append(el('span', 'hb-rec-time', new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
      if (r.undone) top.append(el('span', 'hb-tag', 'Undone'));
      else if (r.canUndo) {
        const u = el('button', 'hb-link', 'Undo');
        u.type = 'button';
        u.onclick = async () => {
          u.disabled = true;
          const res = await backend.undo(r.id).catch(() => ({ ok: false }));
          say('sys', res.ok ? 'Undone. Jira is back to how it was.' : 'Some changes could not be undone. Check the issues.');
          await refresh();
        };
        top.append(u);
      }
      box.append(top);
      const heard = el('p', 'hb-heard', `“${r.heard}”`);
      heard.dir = 'auto';
      box.append(heard);
      const ul = el('ul');
      for (const l of r.lines) ul.append(el('li', l.ok ? '' : 'is-fail', l.text));
      box.append(ul);
      receipts.append(box);
    }
  }

  say(
    'hb',
    'Hi. Ask for your brief, ask what is at risk, or just tell me what you did. I only change Jira after you say yes.',
    'en',
  );
  void refresh();
  return { send };
}

function micProblem(reason: string): string {
  switch (reason) {
    case 'not_granted':
      return 'Microphone is off for this page. You can keep typing.';
    case 'unavailable':
      return 'Voice input is not available here. You can keep typing.';
    case 'rate_limited':
      return 'Voice input is busy. Try again in a moment.';
    case 'dismissed':
      return 'No problem. Tap the mic again when you are ready.';
    default:
      return 'The microphone stopped. Try again, or type.';
  }
}

const MIC_SVG =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"/></svg>';

/** A constant, app-owned SVG: the only markup this file ever parses. */
function micIcon(): Node {
  const t = document.createElement('template');
  t.innerHTML = MIC_SVG;
  return t.content.firstChild!;
}
