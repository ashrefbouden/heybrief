// The HeyBrief voice console: talk (or type), hear the answer, approve writes, watch Jira change.
// Plain DOM so the same file runs in the browser prototype and in a Forge Custom UI page.
// Every string from the backend goes in with textContent: nothing from the backend is parsed as HTML.

import { S, type Strings } from './i18n';
import type { Backend, BoardIssue, Lang, Listener, ReceiptView, Turn } from './types';
import { LANG_NAME, installHint, pickVoice } from './voices';

export interface ConsoleOptions {
  /** Story chips shown after the built-in ones (the prototype's talk-back examples). `lang` switches language first. */
  chips?: Array<{ label: string; text: string; lang?: Lang }>;
}

const CONFIRM_MS = 120_000;
/** Urgent heads-up poll. Background tabs throttle timers to about once a minute anyway. */
export const ALERT_POLL_MS = 60_000;
const ALERT_FIRST_MS = 4_000;
/** One poll timer per page, even when the prototype remounts the console with a new listener. */
let alertTimer: ReturnType<typeof setInterval> | undefined;
let alertKick: ReturnType<typeof setTimeout> | undefined;
const SILENCE_MS = 1400;
const ISSUE_KEY = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/g;

type Who = 'me' | 'hb' | 'sys';
type State = 'ready' | 'listening' | 'thinking' | 'speaking';

function defaultLang(): Lang {
  const l = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return l === 'fr' || l === 'ar' ? l : 'en';
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Text with issue keys shown as key badges. Built from text nodes only. */
function withKeys(text: string): DocumentFragment {
  const f = document.createDocumentFragment();
  let last = 0;
  for (const m of text.matchAll(ISSUE_KEY)) {
    if (m.index! > last) f.append(document.createTextNode(text.slice(last, m.index)));
    const k = el('span', 'hb-key', m[1]);
    k.dir = 'ltr';
    f.append(k);
    last = m.index! + m[0].length;
  }
  if (last < text.length) f.append(document.createTextNode(text.slice(last)));
  return f;
}

export function mountConsole(root: HTMLElement, backend: Backend, listener: Listener | null, opts: ConsoleOptions = {}) {
  // ---------- state ----------
  let lang: Lang = defaultLang();
  let t: Strings = S[lang];
  const warnedNoVoice = new Set<Lang>();
  let minutes: number | undefined;
  let speakOn = true;
  let busy = false;
  let listening = false;
  let pending: { id: string; deadline: number; lang: Lang } | undefined;
  let lastBoard = new Map<string, string>();
  let lastIssues: BoardIssue[] | null = null;
  let boardFailed = false;
  let lastReceipts: ReceiptView[] = [];
  let silenceTimer: ReturnType<typeof setTimeout> | undefined;
  let countdown: ReturnType<typeof setInterval> | undefined;
  let audio: AudioContext | undefined;
  let alertPendingId: string | undefined;
  let lastAlert: Turn | undefined;

  // ---------- layout ----------
  root.replaceChildren();
  const app = el('div', 'hb');

  // Header
  const head = el('header', 'hb-head');
  const brand = el('div', 'hb-brand');
  const logo = el('span', 'hb-logo');
  logo.innerHTML = MONO;
  const brandText = el('div');
  const title = el('h1', '', 'HeyBrief');
  const tagline = el('p', 'hb-sub');
  brandText.append(title, tagline);
  brand.append(logo, brandText);
  const badge = el('span', 'hb-badge');
  badge.append(el('span', 'hb-badge-dot'), document.createTextNode(backend.label));

  const controls = el('div', 'hb-controls');
  const langSeg = el('div', 'hb-seg');
  langSeg.setAttribute('role', 'radiogroup');
  const langBtns = new Map<Lang, HTMLButtonElement>();
  for (const [v, label] of [
    ['en', 'EN'],
    ['fr', 'FR'],
    ['ar', 'عربي'],
  ] as const) {
    const b = el('button', 'hb-seg-btn', label);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.lang = v;
    b.title = LANG_NAME[v];
    b.onclick = () => setLang(v);
    langBtns.set(v, b);
    langSeg.append(b);
  }

  const minSel = el('select', 'hb-select');
  minSel.onchange = () => (minutes = minSel.value ? Number(minSel.value) : undefined);

  const speakBtn = el('button', 'hb-icon-btn');
  speakBtn.type = 'button';
  speakBtn.onclick = () => {
    speakOn = !speakOn;
    if (!speakOn) {
      window.speechSynthesis?.cancel();
      if (state === 'speaking') setState('ready');
    }
    renderStatic();
  };
  controls.append(langSeg, minSel, speakBtn);

  const demo = el('div', 'hb-demo');
  let resetBtn: HTMLButtonElement | undefined;
  let simBtn: HTMLButtonElement | undefined;
  let outBtn: HTMLButtonElement | undefined;
  if (backend.reset) {
    resetBtn = el('button', 'hb-ghost');
    resetBtn.type = 'button';
    resetBtn.onclick = async () => {
      await backend.reset!();
      log.replaceChildren();
      clearPending();
      lastBoard = new Map();
      say('sys', t.demoResetDone);
      await refresh();
    };
    demo.append(resetBtn);
  }
  if (backend.simulateIncident) {
    simBtn = el('button', 'hb-ghost is-danger');
    simBtn.type = 'button';
    simBtn.hidden = !!backend.pageInfo; // live page: admins with a demo project only
    simBtn.onclick = async () => {
      simBtn!.disabled = true;
      try {
        await backend.simulateIncident!();
      } catch (e) {
        say('sys', e instanceof Error ? e.message : t.failed);
        return;
      } finally {
        simBtn!.disabled = false;
      }
      say('sys', t.demoIncidentDone);
      await refresh();
      if (alertKick) clearTimeout(alertKick);
      // Jira search can take a few seconds to see a new issue: look now, and again shortly.
      alertKick = setTimeout(() => void pollAlerts(), 1500);
      setTimeout(() => void pollAlerts(), 6000);
    };
    demo.append(simBtn);
  }
  if (backend.simulateOutage) {
    outBtn = el('button', 'hb-ghost is-danger');
    outBtn.type = 'button';
    outBtn.onclick = async () => {
      await backend.simulateOutage!();
      say('sys', t.demoOutageDone);
      if (alertKick) clearTimeout(alertKick);
      alertKick = setTimeout(() => void pollAlerts(), 1500);
    };
    demo.append(outBtn);
  }
  let pageInfo: { isAdmin: boolean; projectKey: string } | undefined;
  backend
    .pageInfo?.()
    .then((p) => {
      pageInfo = p;
      if (simBtn) simBtn.hidden = !(p.isAdmin && p.projectKey);
      if (lastIssues && !lastIssues.length) renderBoard(lastIssues, false);
    })
    .catch(() => undefined);
  head.append(brand, badge, controls);
  if (demo.childElementCount) head.append(demo);

  // Conversation column
  const main = el('main', 'hb-main');
  const convo = el('section', 'hb-convo hb-card');

  const stage = el('div', 'hb-stage');
  const stateDot = el('span', 'hb-state-dot');
  const stateText = el('span', 'hb-state-text');
  const voiceStatus = el('span', 'hb-voice');
  voiceStatus.setAttribute('aria-live', 'polite');
  const stateWrap = el('div', 'hb-state');
  // Live voice meter: five bars that breathe while listening, think and speak (pure CSS, follows data-state).
  const meter = el('span', 'hb-meter');
  meter.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 5; i++) meter.append(el('i'));
  stateWrap.append(meter, stateDot, stateText);
  stage.append(stateWrap, voiceStatus);

  const log = el('div', 'hb-log');
  log.setAttribute('role', 'log');
  log.setAttribute('aria-live', 'polite');
  // When the gate or a heads-up takes room, keep the newest message in view.
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => (log.scrollTop = log.scrollHeight)).observe(log);

  // Urgent heads-up banner. Sound and speech are best effort (browsers may block them).
  const alertBar = el('div', 'hb-alert');
  alertBar.setAttribute('role', 'alert');
  alertBar.hidden = true;
  const alertIcon = el('span', 'hb-alert-icon');
  alertIcon.append(icon('bell'));
  const alertBody = el('div', 'hb-alert-body');
  const alertTitle = el('div', 'hb-alert-title');
  const alertText = el('p', 'hb-alert-text');
  alertBody.append(alertTitle, alertText);
  alertBar.append(alertIcon, alertBody);

  // The gate: what will change, and the only buttons that write.
  const gate = el('div', 'hb-gate');
  gate.hidden = true;
  gate.setAttribute('role', 'group');
  const gateHead = el('div', 'hb-gate-head');
  const gateIcon = el('span', 'hb-gate-icon');
  gateIcon.append(icon('shield'));
  const gateTitle = el('strong', 'hb-gate-title');
  const gateTimer = el('span', 'hb-gate-timer');
  gateHead.append(gateIcon, gateTitle, gateTimer);
  const gateBar = el('div', 'hb-gate-bar');
  const gateFill = el('div', 'hb-gate-fill');
  gateBar.append(gateFill);
  const gateList = el('ul', 'hb-gate-list');
  const gateNote = el('p', 'hb-gate-note');
  const yesBtn = el('button', 'hb-btn hb-btn-primary');
  const noBtn = el('button', 'hb-btn');
  yesBtn.type = noBtn.type = 'button';
  const gateRow = el('div', 'hb-gate-row');
  gateRow.append(yesBtn, noBtn);
  gate.append(gateHead, gateBar, gateList, gateRow, gateNote);
  yesBtn.onclick = () => decide(true);
  noBtn.onclick = () => decide(false);

  const dock = el('div', 'hb-dock');
  const chips = el('div', 'hb-chips');
  const bar = el('form', 'hb-bar');
  const mic = el('button', 'hb-mic');
  mic.type = 'button';
  mic.append(icon('mic'));
  const input = el('input', 'hb-input');
  input.type = 'text';
  input.dir = 'auto';
  input.maxLength = 500;
  const sendBtn = el('button', 'hb-send');
  sendBtn.type = 'submit';
  sendBtn.append(icon('send'));
  bar.append(mic, input, sendBtn);
  bar.onsubmit = (e) => {
    e.preventDefault();
    void send(input.value);
  };
  if (!listener) mic.hidden = true;
  const hint = el('p', 'hb-hint');
  dock.append(chips, bar, hint);

  convo.append(stage, alertBar, log, gate, dock);

  // Side column: Team pulse and Receipt
  const side = el('aside', 'hb-side');
  const pulseCard = el('section', 'hb-card hb-pulse');
  const pulseHead = el('div', 'hb-card-head');
  const pulseTitle = el('h2');
  const pulseNote = el('span', 'hb-card-note');
  pulseHead.append(pulseTitle, pulseNote);
  const stats = el('div', 'hb-stats');
  const board = el('div', 'hb-board');
  pulseCard.append(pulseHead, stats, board);

  const recCard = el('section', 'hb-card hb-receipt');
  const recHead = el('div', 'hb-card-head');
  const recTitle = el('h2');
  const recNote = el('span', 'hb-card-note');
  recHead.append(recTitle, recNote);
  const receipts = el('div', 'hb-receipts');
  recCard.append(recHead, receipts);
  side.append(pulseCard, recCard);

  main.append(convo, side);
  app.append(head, main);
  root.append(app);

  // ---------- language ----------
  function setLang(l: Lang) {
    lang = l;
    t = S[l];
    app.dir = l === 'ar' ? 'rtl' : 'ltr';
    app.lang = l;
    document.documentElement.lang = l;
    renderStatic();
    if (starter) showStarter();
    if (lastIssues) renderBoard(lastIssues, false);
    void backend
      .receipts(lang)
      .then(renderReceipts)
      .catch(() => renderReceipts(lastReceipts));
  }

  /** Every label that depends on the language. */
  function renderStatic() {
    tagline.textContent = t.tagline;
    for (const [v, b] of langBtns) b.setAttribute('aria-checked', String(v === lang));
    langSeg.setAttribute('aria-label', t.langLabel);
    minSel.setAttribute('aria-label', t.timeLabel);
    const cur = minSel.value;
    minSel.replaceChildren();
    for (const v of ['', '4', '12', '25']) {
      const o = el('option', '', v ? t.timeDrive(Number(v)) : t.timeStandard);
      o.value = v;
      minSel.append(o);
    }
    minSel.value = cur;
    speakBtn.replaceChildren(icon(speakOn ? 'volume' : 'mute'));
    speakBtn.setAttribute('aria-pressed', String(speakOn));
    speakBtn.setAttribute('aria-label', speakOn ? t.voiceOn : t.voiceOff);
    speakBtn.title = speakOn ? t.voiceOn : t.voiceOff;
    if (resetBtn) resetBtn.textContent = t.demoReset;
    if (simBtn) simBtn.textContent = t.demoIncident;
    if (outBtn) outBtn.textContent = t.demoOutage;
    convo.setAttribute('aria-label', t.conversation);
    input.placeholder = listener ? t.placeholderMic : t.placeholderType;
    input.setAttribute('aria-label', t.conversation);
    mic.setAttribute('aria-label', listening ? t.stopSend : t.talk);
    sendBtn.setAttribute('aria-label', t.send);
    sendBtn.title = t.send;
    hint.textContent = listener ? t.hintMic : t.hintNoMic;
    gateTitle.textContent = t.gateTitle;
    gateNote.textContent = t.gateNote;
    yesBtn.textContent = t.yes;
    noBtn.textContent = t.no;
    alertTitle.textContent = lastAlert?.alert?.severity === 'critical' ? `${t.headsUp} · ${t.critical}` : t.headsUp;
    pulseTitle.textContent = t.pulse;
    pulseNote.textContent = t.pulseNote;
    recTitle.textContent = t.receipt;
    recNote.textContent = t.receiptNote;
    renderChips();
    renderState();
    renderVoiceStatus();
  }

  function renderChips() {
    chips.replaceChildren();
    const all = [...t.chips.map((c) => ({ ...c, lang: undefined as Lang | undefined })), ...(opts.chips ?? [])];
    for (const c of all) {
      const b = el('button', 'hb-chip' + (c.lang ? ' is-story' : ''), c.label);
      b.type = 'button';
      b.title = c.text;
      if (c.lang) b.lang = c.lang;
      b.onclick = () => {
        if (c.lang && c.lang !== lang) setLang(c.lang);
        void send(c.text);
      };
      chips.append(b);
    }
  }

  // ---------- state line ----------
  let state: State = 'ready';
  function setState(s: State) {
    state = s;
    renderState();
  }
  function renderState() {
    app.dataset.state = state;
    stateText.textContent = { ready: t.ready, listening: t.listening, thinking: t.thinking, speaking: t.speaking }[state];
  }

  // ---------- conversation ----------
  function say(who: Who, text: string, l?: Lang) {
    // Anything after the greeting (an answer, a heads-up, a note) replaces the starter sentences.
    if (starter) {
      starter.remove();
      starter = null;
    }
    const row = el('div', `hb-msg hb-${who}`);
    if (who === 'hb') {
      const av = el('span', 'hb-avatar');
      av.innerHTML = MONO;
      row.append(av);
    }
    const b = el('div', 'hb-bubble');
    b.dir = l === 'ar' ? 'rtl' : 'auto';
    if (l) b.lang = l;
    b.append(who === 'sys' ? document.createTextNode(text) : withKeys(text));
    row.append(b);
    log.append(row);
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
      ? t.noSynth
      : v
        ? t.speakingWith(LANG_NAME[lang], v.name.replace(/^Microsoft\s+/, '').replace(/\s+-\s+.*$/, ''))
        : `${t.noVoice(LANG_NAME[lang])} ${installHint(lang, navigator.userAgent)}`;
    voiceStatus.title = v ? v.name : '';
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
        say('sys', `${S[l].noVoice(LANG_NAME[l])} ${installHint(l, navigator.userAgent)}`);
      }
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = l === 'en' ? 1.02 : 0.95;
    u.onstart = () => setState('speaking');
    u.onend = u.onerror = () => {
      if (state === 'speaking') setState('ready');
    };
    synth.speak(u);
  }

  function setBusy(b: boolean) {
    busy = b;
    app.classList.toggle('is-busy', b);
    sendBtn.disabled = yesBtn.disabled = noBtn.disabled = b;
    if (b) setState('thinking');
    else if (state === 'thinking') setState('ready');
  }

  /** First 10 seconds: the two sentences that show what HeyBrief does, big enough to tap. Gone after the first message. */
  let starter: HTMLElement | null = null;
  function showStarter() {
    starter?.remove();
    starter = el('div', 'hb-starter');
    starter.append(el('p', 'hb-starter-title', t.tryTitle));
    for (const phrase of t.tries) {
      const b = el('button', 'hb-starter-btn');
      b.type = 'button';
      b.dir = 'auto';
      b.textContent = `“${phrase}”`;
      b.onclick = () => void send(phrase);
      starter.append(b);
    }
    log.append(starter);
  }

  async function send(raw: string) {
    const text = raw.replace(/\s+/g, ' ').trim();
    if (!text || busy) return;
    starter?.remove();
    starter = null;
    input.value = '';
    say('me', text);
    setBusy(true);
    try {
      show(await backend.ask(text, { lang, minutes }));
    } catch {
      say('sys', t.failed);
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  async function decide(yes: boolean) {
    if (!pending || busy) return;
    const p = pending;
    say('me', yes ? t.yesWord : t.no, lang);
    setBusy(true);
    try {
      show(await backend.decide(p.id, yes, p.lang));
    } catch {
      say('sys', t.failed);
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  function show(turn: Turn) {
    // The banner stays up while its own proposal is pending (a "why?" keeps it), and goes with anything else.
    if (turn.alert) {
      showAlert(turn);
      alertPendingId = turn.pendingId;
    } else if (turn.pendingId !== alertPendingId) alertBar.hidden = true;
    say(turn.failed ? 'sys' : 'hb', turn.speech, turn.lang);
    speak(turn.speech, turn.lang);
    if (turn.pendingId) setPending(turn.pendingId, turn.lang, turn.changes ?? []);
    else clearPending();
  }

  function setPending(id: string, l: Lang, changes: string[]) {
    pending = { id, deadline: Date.now() + CONFIRM_MS, lang: l };
    gateList.replaceChildren();
    for (const c of changes) {
      const li = el('li');
      li.dir = 'auto';
      li.append(icon(changeIcon(c)), withKeys(c));
      gateList.append(li);
    }
    gateList.hidden = !changes.length;
    gate.hidden = false;
    tick();
    if (countdown) clearInterval(countdown);
    countdown = setInterval(tick, 1000);
    gate.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }

  function clearPending() {
    pending = undefined;
    alertBar.hidden = true;
    gate.hidden = true;
    if (countdown) clearInterval(countdown);
    countdown = undefined;
  }

  function tick() {
    if (!pending) return;
    const ms = Math.max(0, pending.deadline - Date.now());
    const left = Math.round(ms / 1000);
    gateFill.style.width = `${(ms / CONFIRM_MS) * 100}%`;
    gate.classList.toggle('is-late', left <= 20);
    gateTimer.textContent = left ? t.expiresIn(`${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`) : t.expired;
    if (!left) {
      clearPending();
      say('sys', t.expiredMsg);
    }
  }

  // ---------- urgent heads-up ----------
  function showAlert(turn: Turn) {
    lastAlert = turn;
    alertTitle.textContent = turn.alert?.severity === 'critical' ? `${t.headsUp} · ${t.critical}` : t.headsUp;
    alertText.replaceChildren(withKeys(turn.speech));
    alertBar.dir = turn.lang === 'ar' ? 'rtl' : 'auto';
    alertBar.classList.toggle('is-critical', turn.alert?.severity === 'critical');
    alertBar.hidden = false;
    chime(turn.alert?.severity === 'critical' ? 2 : 1);
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
      const a = await backend.alerts(lang);
      if (!a.speech || busy || listening || pending) return;
      show(a);
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
    mic.setAttribute('aria-label', t.stopSend);
    setState('listening');
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
        say('sys', t.mic[(reason as keyof Strings['mic']) in t.mic ? (reason as keyof Strings['mic']) : 'other']);
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
    mic.setAttribute('aria-label', t.talk);
    if (state === 'listening') setState('ready');
  }

  // ---------- Team pulse + receipt ----------
  async function refresh() {
    const [issues, recs] = await Promise.all([
      backend.board().then(
        (x) => ((boardFailed = false), x),
        () => ((boardFailed = true), lastIssues ?? []),
      ),
      backend.receipts(lang).catch(() => lastReceipts),
    ]);
    renderBoard(issues, true);
    renderReceipts(recs);
  }

  /**
   * HeyBrief's own view of the project, not a copy of a Jira board: what is stuck and what it holds up,
   * what is late, your plate, and who carries the load. Changed rows flash after each answer.
   */
  function renderBoard(issues: BoardIssue[], diff: boolean) {
    lastIssues = issues;
    const changed = new Set<string>();
    if (diff) {
      const next = new Map<string, string>();
      for (const i of issues) {
        const sig = [i.status, i.assignee ?? '', i.flagged, i.blockedBy.join(','), i.blocks.join(',')].join('|');
        next.set(i.key, sig);
        if (lastBoard.size && lastBoard.get(i.key) !== sig) changed.add(i.key);
      }
      lastBoard = next;
    }

    const today = new Date().toISOString().slice(0, 10);
    const open = issues.filter((i) => i.statusCategory !== 'done');
    const byKey = new Map(issues.map((i) => [i.key, i]));
    const isStuck = (i: BoardIssue) => i.statusCategory !== 'done' && (/block/i.test(i.status) || i.flagged);
    const stuck = open.filter(isStuck);
    const late = open.filter((i) => i.dueDate && i.dueDate < today && !isStuck(i));
    const mine = open.filter((i) => i.mine);
    const done = issues.filter((i) => i.statusCategory === 'done');

    stats.replaceChildren(
      stat(t.statBlocked, stuck.length, stuck.length ? 'warn' : 'ok'),
      stat(t.statLate, late.length, late.length ? 'warn' : 'ok'),
      stat(t.statMine, mine.length, ''),
      stat(t.statDone, done.length, done.length ? 'good' : ''),
    );
    board.replaceChildren();

    if (boardFailed && !issues.length) {
      board.append(el('p', 'hb-empty is-warn', t.boardError));
      return;
    }
    if (!issues.length) {
      board.append(backend.loadDemo && pageInfo?.isAdmin ? firstRun() : el('p', 'hb-empty', t.boardEmpty));
      return;
    }

    // 1. Stuck chains: the blocked issue, then what it waits on and what it holds up.
    const chains = section(t.stuck, stuck.length ? t.blockedCount(stuck.length) : t.nothingBlocked, stuck.length ? 'warn' : 'ok');
    for (const s of stuck) {
      const chain = el('div', 'hb-chain' + (changed.has(s.key) ? ' is-changed' : ''));
      chain.append(row(s, changed.has(s.key)));
      const waiting = s.blocks.map((k) => byKey.get(k)).filter((x): x is BoardIssue => !!x && x.statusCategory !== 'done');
      const unblockers = s.blockedBy.map((k) => byKey.get(k)).filter((x): x is BoardIssue => !!x);
      if (unblockers.length) {
        const u = el('div', 'hb-chain-sub');
        u.append(el('span', 'hb-chain-label', t.unblockedBy));
        for (const x of unblockers) u.append(row(x, changed.has(x.key), true));
        chain.append(u);
      }
      if (waiting.length) {
        const w = el('div', 'hb-chain-sub');
        w.append(el('span', 'hb-chain-label', t.holdingUp(waiting.length)));
        for (const x of waiting) w.append(row(x, changed.has(x.key), true));
        chain.append(w);
      }
      chains.body.append(chain);
    }
    board.append(chains.box);

    // 2. Late work.
    if (late.length) {
      const l = section(t.late, t.pastDue(late.length), 'warn');
      for (const i of late) l.body.append(row(i, changed.has(i.key)));
      board.append(l.box);
    }

    // 3. Your plate, blocked and in progress first.
    const plate = section(t.plate, t.openCount(mine.length));
    for (const i of [...mine].sort((a, b) => rankStatus(a) - rankStatus(b))) plate.body.append(row(i, changed.has(i.key)));
    if (!mine.length) plate.body.append(el('p', 'hb-empty', t.plateEmpty));
    board.append(plate.box);

    // 4. Team load: share of open work per person; the overload rule is 40% with at least 6 open issues.
    const load = new Map<string, number>();
    for (const i of open) load.set(i.assignee ?? t.unassigned, (load.get(i.assignee ?? t.unassigned) ?? 0) + 1);
    const team = section(t.load, t.openCount(open.length));
    const max = Math.max(1, ...load.values());
    for (const [who, n] of [...load.entries()].sort((a, b) => b[1] - a[1])) {
      const share = open.length ? n / open.length : 0;
      const heavy = share > 0.4 && open.length >= 6;
      const r = el('div', 'hb-load' + (heavy ? ' is-heavy' : ''));
      const av = el('span', 'hb-initials', initials(who));
      const name = el('span', 'hb-load-name', who);
      const track = el('div', 'hb-load-bar');
      const fill = el('div', 'hb-load-fill');
      fill.style.width = `${Math.round((n / max) * 100)}%`;
      track.append(fill);
      const num = el('span', 'hb-load-n', String(n));
      if (heavy) name.append(el('span', 'hb-pill is-warn', t.overloaded));
      r.append(av, name, track, num);
      team.body.append(r);
    }
    board.append(team.box);

    // 5. Finished: one line, keys only.
    if (done.length) {
      const d = section(t.done, String(done.length), 'ok');
      const keys = el('p', 'hb-done');
      for (const i of done) {
        const k = el('span', 'hb-key is-done' + (changed.has(i.key) ? ' is-changed' : ''), i.key);
        k.title = i.summary;
        keys.append(k);
      }
      d.body.append(keys);
      board.append(d.box);
    }
  }

  /** First run on an empty site: load the demo story right here, no settings page to find. */
  function firstRun(): HTMLElement {
    const box = el('form', 'hb-firstrun');
    box.append(el('strong', '', t.firstRunTitle), el('p', '', t.firstRunBody));
    const row = el('div', 'hb-firstrun-row');
    const key = el('input', 'hb-firstrun-key');
    key.placeholder = 'DEMO';
    key.maxLength = 20;
    key.dir = 'ltr';
    key.setAttribute('aria-label', t.firstRunKey);
    const go = el('button', 'hb-btn hb-btn-primary', t.firstRunLoad);
    go.type = 'submit';
    row.append(key, go);
    box.append(row);
    box.onsubmit = async (e) => {
      e.preventDefault();
      const pk = key.value.trim().toUpperCase();
      if (!/^[A-Z][A-Z0-9_]{0,19}$/.test(pk)) {
        key.focus();
        return;
      }
      go.disabled = key.disabled = true;
      say('sys', t.firstRunWorking);
      try {
        const r = await backend.loadDemo!(pk);
        pageInfo = { isAdmin: true, projectKey: pk };
        if (simBtn) simBtn.hidden = false;
        say('hb', r.script ? t.firstRunDone(r.script.risk, r.script.talkback) : r.message, lang);
        await refresh();
      } catch (err) {
        say('sys', err instanceof Error ? err.message : t.failed);
        go.disabled = key.disabled = false;
      }
    };
    return box;
  }

  function stat(label: string, n: number, tone: 'warn' | 'ok' | 'good' | '') {
    const s = el('div', 'hb-stat' + (tone ? ` is-${tone}` : ''));
    s.append(el('span', 'hb-stat-n', String(n)), el('span', 'hb-stat-label', label));
    return s;
  }

  function section(title: string, note: string, tone: 'warn' | 'ok' | '' = '') {
    const box = el('section', 'hb-sec' + (tone ? ` is-${tone}` : ''));
    const h = el('div', 'hb-sec-head');
    h.append(el('h3', '', title), el('span', 'hb-sec-note', note));
    const body = el('div', 'hb-sec-body');
    box.append(h, body);
    return { box, body };
  }

  function rankStatus(i: BoardIssue) {
    return /block/i.test(i.status) || i.flagged ? 0 : i.statusCategory === 'inprogress' ? 1 : 2;
  }

  function row(i: BoardIssue, changed: boolean, compact = false) {
    const r = el('div', 'hb-row' + (changed ? ' is-changed' : '') + (compact ? ' is-compact' : ''));
    const stateName = /block/i.test(i.status) || i.flagged ? 'stuck' : i.statusCategory;
    const dot = el('span', `hb-dot is-${stateName}`);
    dot.title = i.status;
    const key = el('span', 'hb-key', i.key);
    key.dir = 'ltr';
    const sum = el('span', 'hb-sum', i.summary);
    sum.dir = 'auto';
    sum.title = i.summary;
    r.append(dot, key, sum);
    const meta = el('span', 'hb-meta');
    const status = el('span', `hb-status is-${stateName}`, i.status);
    meta.append(status);
    if (!compact && i.assignee && !i.mine) meta.append(el('span', 'hb-initials is-sm', initials(i.assignee)));
    if (i.dueDate) meta.append(el('span', 'hb-due', i.dueDate.slice(5)));
    r.append(meta);
    return r;
  }

  function renderReceipts(recs: ReceiptView[]) {
    lastReceipts = recs;
    receipts.replaceChildren();
    if (!recs.length) {
      const empty = el('div', 'hb-empty-card');
      empty.append(icon('receipt'), el('p', '', t.receiptEmpty));
      receipts.append(empty);
      return;
    }
    for (const r of recs.slice(0, 6)) {
      const box = el('article', 'hb-rec' + (r.undone ? ' is-undone' : r.allOk ? '' : ' is-partial'));
      const top = el('div', 'hb-rec-top');
      top.append(
        el('span', `hb-pill is-${r.kind}`, r.undone ? t.undone : t.kind[r.kind]),
        el('span', 'hb-rec-time', new Date(r.at).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })),
      );
      if (r.canUndo) {
        const u = el('button', 'hb-ghost is-sm');
        u.append(icon('undo'), document.createTextNode(t.undo));
        u.type = 'button';
        u.onclick = async () => {
          u.disabled = true;
          const res = await backend.undo(r.id).catch(() => ({ ok: false }));
          say('sys', res.ok ? t.undoOk : t.undoFail);
          await refresh();
        };
        top.append(u);
      }
      box.append(top);
      const said = el('div', 'hb-rec-said');
      said.append(el('span', 'hb-rec-label', t.youSaid));
      const heard = el('q', 'hb-heard', r.heard);
      heard.dir = 'auto';
      said.append(heard);
      box.append(said);
      if (r.writeMs !== undefined) {
        const sec = (ms?: number) => (ms === undefined ? undefined : (ms / 1000).toFixed(1));
        const n = r.lines.filter((l) => l.ok).length;
        box.append(el('p', 'hb-rec-measure', t.measured(n, r.kind === 'talkback', sec(r.planMs), sec(r.writeMs))));
      }
      const ul = el('ul', 'hb-rec-lines');
      for (const l of r.lines) {
        const li = el('li', l.ok ? '' : 'is-fail');
        li.dir = 'auto';
        li.append(icon(l.ok ? 'check' : 'x'), withKeys(l.text));
        ul.append(li);
      }
      box.append(ul);
      if (r.readback && r.readback !== r.heard) {
        const det = el('details', 'hb-rec-more');
        det.append(el('summary', '', t.proposed));
        const p = el('p', '', r.readback);
        p.dir = 'auto';
        det.append(p);
        box.append(det);
      }
      receipts.append(box);
    }
  }

  setLang(lang);
  window.speechSynthesis?.addEventListener?.('voiceschanged', renderVoiceStatus);
  say('hb', t.hello, lang);
  showStarter();
  void refresh();
  if (alertTimer) clearInterval(alertTimer);
  if (alertKick) clearTimeout(alertKick);
  if (backend.alerts) {
    // Coming back to the tab is when news matters: check at once (at most every 10 s).
    let lastFocusPoll = 0;
    const onBack = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastFocusPoll < 10_000) return;
      lastFocusPoll = Date.now();
      void pollAlerts();
    };
    document.addEventListener('visibilitychange', onBack);
    window.addEventListener('focus', onBack);
    alertKick = setTimeout(() => void pollAlerts(), ALERT_FIRST_MS);
    alertTimer = setInterval(() => void pollAlerts(), ALERT_POLL_MS);
  }
  return { send };
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '')).toUpperCase() || '?';
}

/** Pick an icon for a change line by its shape, in any of the three languages. */
function changeIcon(line: string): IconName {
  if (/→|moved|passe à|نُقل/.test(line)) return 'arrow';
  if (/flag|signal|علامة|عُلّم/i.test(line)) return 'flag';
  if (/block|bloque|يحظر/i.test(line)) return 'link';
  if (/notif|prévenu|أُبلغ/i.test(line)) return 'bell';
  if (/follow-up|suivi|متابعة|Created|créé|أُنشئت/i.test(line)) return 'plus';
  if (/Confluence/.test(line)) return 'doc';
  if (/assign|أُسند/i.test(line)) return 'user';
  return 'comment';
}

// App-owned, constant SVG paths: the only markup this file ever builds from strings.
type IconName =
  | 'brand'
  | 'wave'
  | 'mic'
  | 'send'
  | 'volume'
  | 'mute'
  | 'bell'
  | 'shield'
  | 'check'
  | 'x'
  | 'undo'
  | 'receipt'
  | 'arrow'
  | 'flag'
  | 'link'
  | 'plus'
  | 'doc'
  | 'user'
  | 'comment';
const PATHS: Record<IconName, string> = {
  wave: 'M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4',
  mic: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3ZM19 11a7 7 0 0 1-14 0M12 18v3',
  send: 'M5 12h13M13 6l6 6-6 6',
  volume: 'M4 9v6h4l5 4V5L8 9H4ZM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12',
  mute: 'M4 9v6h4l5 4V5L8 9H4ZM17 9l5 6M22 9l-5 6',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2ZM10 20a2 2 0 0 0 4 0',
  shield: 'M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3ZM9 12l2 2 4-4',
  check: 'M5 12.5 10 17 19 7',
  x: 'M6 6l12 12M18 6 6 18',
  undo: 'M9 7 4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3ZM9 8h6M9 12h6',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  link: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66L12 6.34M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
  plus: 'M12 5v14M5 12h14',
  doc: 'M7 3h7l5 5v13H7V3ZM14 3v5h5M10 13h6M10 17h6',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0',
  comment: 'M5 5h14v10H9l-4 4V5Z',
  brand: 'M4 11.5v1M7.5 9v6M11 6.5v11M14.5 12.5l2.5 2.5L21.5 9.5',
};

/** The HB monogram from the app icon (static markup, no user data). */
const MONO = '<svg viewBox="8 16 50 28" aria-hidden="true" class="hb-mono"><path fill="#fff" d="M11.6 20.2H17.4V27.4H27.1V20.2H32.9V27.4L27.8 32.4H17.4V40.3H11.6Z"/><path fill="#7fb4ff" d="M34.8 20.2H47.4C51.6 20.2 53.8 22.6 53.8 25.3C53.8 27.2 53 28.6 52 29.4C54.2 30.4 55.4 32.4 55.4 34.8C55.4 38 52.6 40.3 48.4 40.3H32.3L37.5 35.2H47.6C48.5 35.2 49.1 34.6 49.1 33.8C49.1 33 48.5 32.4 47.6 32.4H37.5L29.9 40.3H27.1V35.6L35.3 27.4H46.3C47.2 27.4 47.8 26.9 47.8 26.35C47.8 25.8 47.2 25.3 46.3 25.3H34.8Z"/></svg>';

function icon(name: IconName): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `hb-ico is-${name}`);
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', PATHS[name]);
  svg.append(p);
  return svg;
}
