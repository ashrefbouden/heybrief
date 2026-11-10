// The HeyBrief voice console: talk (or type), hear the answer, confirm writes, watch the board change.
// Plain DOM so the same file runs in the browser prototype and in a Forge Custom UI page.
// Every string from the backend goes in with textContent: nothing is parsed as HTML.

import type { Backend, BoardIssue, Lang, Listener, ReceiptView, Turn } from './types';
import { LANG_NAME, installHint, pickVoice } from './voices';

export interface ConsoleOptions {
  /** Suggested phrases shown as chips. */
  chips: Array<{ label: string; text: string; lang?: Lang }>;
  /** Short line under the title. */
  subtitle: string;
}

const CONFIRM_MS = 120_000;
/** Urgent heads-up poll. Background tabs throttle timers to about once a minute anyway. */
export const ALERT_POLL_MS = 60_000;
const ALERT_FIRST_MS = 4_000;
/** One poll timer per page, even when the prototype remounts the console with a new listener. */
let alertTimer: ReturnType<typeof setInterval> | undefined;
let alertKick: ReturnType<typeof setTimeout> | undefined;
const SILENCE_MS = 1400;
const UI: Record<Lang, { type: string; talk: string; yes: string; no: string; gate: string; hello: string }> = {
  en: {
    type: 'Tap the mic and talk, or type here',
    talk: 'Type what you would say',
    yes: 'Yes, do it',
    no: 'Cancel',
    gate: 'Nothing changes until you say yes.',
    hello: 'Hi. Ask for your brief, ask what is at risk, or just tell me what you did. I only change Jira after you say yes.',
  },
  fr: {
    type: 'Touchez le micro et parlez, ou écrivez ici',
    talk: 'Écrivez ce que vous diriez',
    yes: 'Oui, vas-y',
    no: 'Annuler',
    gate: 'Rien ne change avant votre oui.',
    hello:
      "Bonjour. Demandez votre résumé, les risques, ou dites-moi ce que vous avez fait. Je ne change Jira qu'après votre oui.",
  },
  ar: {
    type: 'اضغط على الميكروفون وتكلم، أو اكتب هنا',
    talk: 'اكتب ما ستقوله',
    yes: 'نعم، نفّذ',
    no: 'إلغاء',
    gate: 'لا يتغير شيء قبل أن تقول نعم.',
    hello: 'مرحبا. اطلب ملخصك، أو اسأل عن المخاطر، أو أخبرني بما أنجزت. لا أغيّر Jira إلا بعد أن تقول نعم.',
  },
};

function defaultLang(): Lang {
  const l = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return l === 'fr' || l === 'ar' ? l : 'en';
}

type Who = 'me' | 'hb' | 'sys';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function mountConsole(root: HTMLElement, backend: Backend, listener: Listener | null, opts: ConsoleOptions) {
  // ---------- state ----------
  let lang: Lang = defaultLang();
  const warnedNoVoice = new Set<Lang>();
  let minutes: number | undefined;
  let speakOn = true;
  let busy = false;
  let listening = false;
  let pending: { id: string; deadline: number; lang: Lang } | undefined;
  let lastBoard = new Map<string, string>();
  let silenceTimer: ReturnType<typeof setTimeout> | undefined;
  let countdown: ReturnType<typeof setInterval> | undefined;
  let audio: AudioContext | undefined;
  let alertPendingId: string | undefined;

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
    ['en', 'English'],
    ['fr', 'Français'],
    ['ar', 'العربية'],
  ]) {
    const o = el('option', '', t);
    o.value = v;
    langSel.append(o);
  }
  langSel.value = lang;
  langSel.onchange = () => setLang(langSel.value as Lang);

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
  if (backend.simulateIncident) {
    const simBtn = el('button', 'hb-toggle', 'Simulate P1 outage');
    simBtn.type = 'button';
    simBtn.title = 'Adds a Highest-priority incident to the simulated Jira. HeyBrief interrupts within seconds.';
    simBtn.onclick = async () => {
      await backend.simulateIncident!();
      say('sys', 'Someone just opened a Highest-priority incident in Jira.');
      await refresh();
      if (alertKick) clearTimeout(alertKick);
      alertKick = setTimeout(() => void pollAlerts(), 1500);
    };
    controls.append(simBtn);
  }
  const voiceStatus = el('p', 'hb-voice');
  voiceStatus.setAttribute('aria-live', 'polite');
  head.append(brand, badge, controls, voiceStatus);

  const main = el('main', 'hb-main');
  const convo = el('section', 'hb-convo');
  convo.setAttribute('aria-label', 'Conversation');
  const log = el('div', 'hb-log');
  log.setAttribute('role', 'log');
  log.setAttribute('aria-live', 'polite');

  // Urgent heads-up banner: the real alert. Sound and speech are best effort (browsers may block them).
  const alertBar = el('div', 'hb-alert');
  alertBar.setAttribute('role', 'alert');
  alertBar.hidden = true;

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
    b.onclick = () => {
      if (c.lang && c.lang !== lang) setLang(c.lang);
      void send(c.text);
    };
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

  convo.append(alertBar, log, confirmCard, chips, bar, hint);

  const side = el('aside', 'hb-side');
  const boardHead = el('h2', '', 'Jira board');
  const board = el('div', 'hb-board');
  const recHead = el('h2', '', 'Receipt');
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

  function voiceFor(l: Lang): SpeechSynthesisVoice | undefined {
    const synth = window.speechSynthesis;
    return synth ? pickVoice(synth.getVoices(), l) : undefined;
  }

  /** Shows which voice will speak, or why none will. Voices load late in Chrome, so this also runs on voiceschanged. */
  function renderVoiceStatus() {
    const v = voiceFor(lang);
    voiceStatus.classList.toggle('is-warn', !v);
    voiceStatus.textContent = !window.speechSynthesis
      ? 'This browser cannot speak answers. They are shown as text.'
      : v
        ? `Speaking ${LANG_NAME[lang]} with: ${v.name}`
        : `No ${LANG_NAME[lang]} voice on this device, so answers are shown as text. ${installHint(lang, navigator.userAgent)}`;
  }

  function speak(text: string, l: Lang) {
    const synth = window.speechSynthesis;
    if (!speakOn || !synth) return;
    synth.cancel();
    const voice = voiceFor(l);
    // Never read Arabic or French with an English voice: it is unintelligible. Show text instead.
    if (!voice) {
      if (!warnedNoVoice.has(l)) {
        warnedNoVoice.add(l);
        say(
          'sys',
          `No ${LANG_NAME[l]} voice is installed here, so this answer is text only. ${installHint(l, navigator.userAgent)}`,
        );
      }
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = l === 'en' ? 1.02 : 0.95;
    synth.speak(u);
  }

  function setLang(l: Lang) {
    lang = l;
    langSel.value = l;
    const t = UI[l];
    input.placeholder = listener ? t.type : t.talk;
    yesBtn.textContent = t.yes;
    noBtn.textContent = t.no;
    confirmText.textContent = t.gate;
    confirmCard.dir = l === 'ar' ? 'rtl' : 'ltr';
    renderVoiceStatus();
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
    say('me', yes ? { en: 'Yes', fr: 'Oui', ar: 'نعم' }[lang] : UI[lang].no, lang);
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
    // The banner stays up while its own proposal is pending (a "why?" keeps it), and goes with anything else.
    if (t.alert) {
      showAlert(t);
      alertPendingId = t.pendingId;
    } else if (t.pendingId !== alertPendingId) alertBar.hidden = true;
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
    alertBar.hidden = true;
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

  // ---------- urgent heads-up ----------
  function showAlert(t: Turn) {
    alertBar.textContent = t.speech;
    alertBar.dir = t.lang === 'ar' ? 'rtl' : 'auto';
    alertBar.classList.toggle('is-critical', t.alert?.severity === 'critical');
    alertBar.hidden = false;
    chime(t.alert?.severity === 'critical' ? 2 : 1);
  }

  /** A short two-tone chime. Silently skipped when the browser has not allowed audio yet. */
  function chime(times: number) {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      audio ??= new Ctx();
      if (audio.state === 'suspended') void audio.resume().catch(() => undefined);
      const t0 = audio.currentTime;
      for (let i = 0; i < times * 2; i++) {
        const o = audio.createOscillator();
        const g = audio.createGain();
        const at = t0 + i * 0.22;
        o.frequency.value = i % 2 ? 660 : 880;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(0.18, at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
        o.connect(g).connect(audio.destination);
        o.start(at);
        o.stop(at + 0.21);
      }
    } catch {
      /* no audio: the banner and the spoken text still carry the alert */
    }
  }
  // Browsers only allow sound after a gesture: unlock audio on the first click anywhere.
  root.addEventListener(
    'pointerdown',
    () => {
      try {
        const Ctx = window.AudioContext;
        if (Ctx) {
          audio ??= new Ctx();
          void audio.resume().catch(() => undefined);
        }
      } catch {
        /* ignore */
      }
    },
    { once: true },
  );

  /** Never interrupt the person mid-sentence, mid-request, or while they are deciding on another change. */
  async function pollAlerts() {
    if (!backend.alerts || busy || listening || pending) return;
    try {
      const t = await backend.alerts(lang);
      if (!t.speech || busy || listening || pending) return;
      show(t);
      await refresh();
    } catch {
      /* a failed poll stays silent */
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
    const started = listener.start(lang, {
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

  setLang(lang);
  window.speechSynthesis?.addEventListener?.('voiceschanged', renderVoiceStatus);
  say('hb', UI[lang].hello, lang);
  void refresh();
  if (alertTimer) clearInterval(alertTimer);
  if (alertKick) clearTimeout(alertKick);
  if (backend.alerts) {
    alertKick = setTimeout(() => void pollAlerts(), ALERT_FIRST_MS);
    alertTimer = setInterval(() => void pollAlerts(), ALERT_POLL_MS);
  }
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
