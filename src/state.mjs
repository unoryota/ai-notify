// Shared state for ai-notify: the mute flag and user config.
//
// Everything lives under XDG paths so that ALL wired agents (Claude Code, Codex,
// Gemini, ...) read the same single source of truth. Flip the flag once and every
// agent in every terminal obeys it — no daemon, no per-terminal action.

import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  mkdirSync,
  existsSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs';

const APP = 'ai-notify';

const xdg = (envVar, fallback) =>
  join(process.env[envVar] || join(homedir(), fallback), APP);

export const stateDir = () => xdg('XDG_STATE_HOME', '.local/state');
export const configDir = () => xdg('XDG_CONFIG_HOME', '.config');

const muteFlagPath = () => join(stateDir(), 'muted');
const configPath = () => join(configDir(), 'config.json');

const ensureDir = (dir) => {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
};

// --- Mute flag -------------------------------------------------------------

export const isMuted = () => existsSync(muteFlagPath());

export const setMuted = (muted) => {
  if (muted) {
    ensureDir(stateDir());
    writeFileSync(muteFlagPath(), '');
  } else if (existsSync(muteFlagPath())) {
    rmSync(muteFlagPath());
  }
  return muted;
};

export const toggleMuted = () => setMuted(!isMuted());

// --- Volume ----------------------------------------------------------------
// A single number (0.0–2.0) in a state file, written by the menu bar slider or
// `ai-notify volume`, read at fire time — just like the mute flag.

const volumeFlagPath = () => join(stateDir(), 'volume');

export const readVolume = () => {
  try {
    const v = parseFloat(readFileSync(volumeFlagPath(), 'utf8'));
    return Number.isFinite(v) ? Math.min(2, Math.max(0, v)) : null;
  } catch {
    return null;
  }
};

export const setVolume = (v) => {
  const n = Math.min(2, Math.max(0, Number(v)));
  ensureDir(stateDir());
  writeFileSync(volumeFlagPath(), String(n));
  return n;
};

// --- Tsundere level --------------------------------------------------------
// A single number 0.0 (full デレ) – 1.0 (full ツン) in a state file, written by
// the menu bar slider or `ai-notify tsundere level`, read at fire time. Overrides
// config.tsundere.level; $AI_NOTIFY_TSUNDERE_LEVEL overrides per window.

const tsundereLevelPath = () => join(stateDir(), 'tsundere-level');

export const readTsundereLevel = () => {
  try {
    const v = parseFloat(readFileSync(tsundereLevelPath(), 'utf8'));
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null;
  } catch {
    return null;
  }
};

export const setTsundereLevel = (v) => {
  const n = Math.min(1, Math.max(0, Number(v)));
  ensureDir(stateDir());
  writeFileSync(tsundereLevelPath(), String(n));
  return n;
};

// --- War mode --------------------------------------------------------------
// A separate read-out skin (military ops room). enabled flag + 0–1 level:
// min 平時 / mid 戦闘中 / max 危機的. Combined with the tsundere level for the
// operator's 好感度. Same small-file pattern as the mute flag / tsundere level.
const warFlagPath = () => join(stateDir(), 'war-enabled');
const warLevelPath = () => join(stateDir(), 'war-level');
export const isWarEnabled = () => existsSync(warFlagPath());
export const setWarEnabled = (on) => {
  ensureDir(stateDir());
  if (on) writeFileSync(warFlagPath(), '');
  else rmSync(warFlagPath(), { force: true });
};
export const readWarLevel = () => {
  // 0 = off (平時, left/min). Default off so it never speaks unless turned up.
  try {
    const v = parseFloat(readFileSync(warLevelPath(), 'utf8'));
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
  } catch {
    return 0;
  }
};
export const setWarLevel = (v) => {
  const n = Math.min(1, Math.max(0, Number(v)));
  ensureDir(stateDir());
  writeFileSync(warLevelPath(), String(n));
  return n;
};

// --- VOICEVOX base prosody -------------------------------------------------
// User-tunable BASE scales for the VOICEVOX read-out — the values used at the
// NORMAL tone; tsundere tones nudge from here. Written by the menu bar sliders /
// `ai-notify voice-prosody`, read at fire time. One small JSON file so all three
// stay in sync. Defaults = neutral (identical to no tuning).
export const VOICE_PROSODY_DEFAULTS = { speed: 1.0, pitch: 0.0, intonation: 1.0 };
export const VOICE_PROSODY_RANGE = { speed: [0.5, 1.5], pitch: [-0.15, 0.15], intonation: [0.0, 1.5] };

const voiceProsodyPath = () => join(stateDir(), 'voice-prosody.json');

const clampProsody = (key, v) => {
  const [lo, hi] = VOICE_PROSODY_RANGE[key] || [0, 2];
  return Math.min(hi, Math.max(lo, Number(v)));
};

export const readVoiceProsody = () => {
  let raw = {};
  try {
    raw = JSON.parse(readFileSync(voiceProsodyPath(), 'utf8')) || {};
  } catch {
    /* missing/corrupt -> defaults */
  }
  const out = {};
  for (const k of Object.keys(VOICE_PROSODY_DEFAULTS)) {
    out[k] = typeof raw[k] === 'number' ? clampProsody(k, raw[k]) : VOICE_PROSODY_DEFAULTS[k];
  }
  return out;
};

// Set one key (speed | pitch | intonation); returns the full updated object, or
// null for an unknown key.
export const setVoiceProsody = (key, value) => {
  if (!(key in VOICE_PROSODY_DEFAULTS)) return null;
  const cur = readVoiceProsody();
  cur[key] = clampProsody(key, value);
  ensureDir(stateDir());
  writeFileSync(voiceProsodyPath(), JSON.stringify(cur));
  return cur;
};

export const resetVoiceProsody = () => {
  try {
    rmSync(voiceProsodyPath(), { force: true });
  } catch {
    /* ignore */
  }
  return { ...VOICE_PROSODY_DEFAULTS };
};

// A small persisted counter (per name), so phrase rotation varies across fires
// even for identical input. Wraps to stay small; best-effort.
export const nextCounter = (name) => {
  const p = join(stateDir(), `ctr-${name}`);
  let n = 0;
  try {
    n = parseInt(readFileSync(p, 'utf8'), 10) || 0;
  } catch {
    /* first use */
  }
  n = (n + 1) % 1000000;
  try {
    ensureDir(stateDir());
    writeFileSync(p, String(n));
  } catch {
    /* ignore */
  }
  return n;
};

// One-time UI nudges (e.g. the post-`init` star hint). Returns true the FIRST
// time it's called for a given key, then records a marker so it never fires
// again — so setup hints inform once without ever nagging on re-runs.
export const firstRunNudge = (key = 'star') => {
  const p = join(stateDir(), `nudged-${key}`);
  if (existsSync(p)) return false;
  try {
    ensureDir(stateDir());
    writeFileSync(p, '');
  } catch {
    /* best-effort: if we can't persist, don't nag repeatedly is preferred, so
       treat a write failure as "already shown". */
    return false;
  }
  return true;
};

// --- Per-pane state --------------------------------------------------------
// Recently-active terminal panes (so the menu bar can offer per-pane voices),
// and a per-tty voice override. Both are small JSON files in the state dir.

const readJson = (p, fallback) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
};
const writeJson = (p, obj) => {
  ensureDir(stateDir());
  writeFileSync(p, JSON.stringify(obj));
};

const panesPath = () => join(stateDir(), 'panes.json');
const paneVoicesPath = () => join(stateDir(), 'pane-voices.json');
const waitingPath = () => join(stateDir(), 'waiting.json');

// Track which panes are waiting for input, so the menu bar icon can show a
// status color (yellow) when any agent needs you.
export const setPaneWaiting = (tty, waiting, message = '') => {
  if (!tty) return;
  const all = readJson(waitingPath(), {});
  // Store the reason text alongside the start time so the popup can filter by
  // wait duration and by message (e.g. ignore sub-agent waits, keep input waits).
  if (waiting) all[tty] = { ts: Date.now(), msg: String(message || '') };
  else delete all[tty];
  writeJson(waitingPath(), all);
};
export const anyWaiting = () => Object.keys(readJson(waitingPath(), {})).length > 0;
export const readWaiting = () => readJson(waitingPath(), {});

// "Waiting" popup (the menu bar app shows a character that says a pane is waiting
// for input). Toggle + optional custom character image, kept as small files the
// Swift app reads directly — same pattern as the mute flag.
const popupFlagPath = () => join(stateDir(), 'popup');
const popupImagePath = () => join(stateDir(), 'popup-image');
export const isPopupEnabled = () => existsSync(popupFlagPath());
export const setPopupEnabled = (on) => {
  ensureDir(stateDir());
  if (on) writeFileSync(popupFlagPath(), '');
  else rmSync(popupFlagPath(), { force: true });
};
export const getPopupImage = () => {
  try {
    return readFileSync(popupImagePath(), 'utf8').trim();
  } catch {
    return '';
  }
};
export const setPopupImage = (p) => {
  ensureDir(stateDir());
  if (p) writeFileSync(popupImagePath(), p);
  else rmSync(popupImagePath(), { force: true });
};

// Per-kind notification toggles — which kinds of agent event actually alert
// (sound / banner / voice / popup). Lets you, e.g., keep "input waiting" but
// silence "done", or enable "sub-agent done". Disabled kinds still update the
// waiting state correctly (so a suppressed "done" still clears a popup).
export const NOTIFY_KINDS = ['input', 'permission', 'info', 'done', 'subagent-done'];
const NOTIFY_KIND_DEFAULTS = { input: true, permission: true, info: false, done: true, 'subagent-done': false };
const notifyKindsPath = () => join(stateDir(), 'notify-kinds.json');
export const getNotifyKinds = () => ({ ...NOTIFY_KIND_DEFAULTS, ...readJson(notifyKindsPath(), {}) });
export const isNotifyKindEnabled = (kind) => {
  const k = getNotifyKinds();
  return kind in k ? !!k[kind] : true; // unknown kinds default to alerting
};
export const setNotifyKind = (kind, on) => {
  const all = readJson(notifyKindsPath(), {});
  all[kind] = !!on;
  writeJson(notifyKindsPath(), all);
};

// Popup notify threshold: only show the popup once a pane has been waiting this
// many seconds (0 = immediately) — so transient / sub-agent waits don't nag.
const popupDelayPath = () => join(stateDir(), 'popup-delay');
export const getPopupDelay = () => {
  try {
    return Math.max(0, parseFloat(readFileSync(popupDelayPath(), 'utf8')) || 0);
  } catch {
    return 0;
  }
};
export const setPopupDelay = (sec) => {
  ensureDir(stateDir());
  if (sec > 0) writeFileSync(popupDelayPath(), String(sec));
  else rmSync(popupDelayPath(), { force: true });
};

// Comma-separated keywords: if a waiting reason message contains any of them,
// the popup is suppressed for that pane (e.g. "subagent,sub-agent,task").
const popupIgnorePath = () => join(stateDir(), 'popup-ignore');
export const getPopupIgnore = () => {
  try {
    return readFileSync(popupIgnorePath(), 'utf8').trim();
  } catch {
    return '';
  }
};
export const setPopupIgnore = (s) => {
  ensureDir(stateDir());
  if (s) writeFileSync(popupIgnorePath(), s);
  else rmSync(popupIgnorePath(), { force: true });
};

// Record this pane as active (keyed by tty). Keeps the 16 most-recent.
export const recordPane = (tty, label) => {
  if (!tty) return;
  const all = readJson(panesPath(), {});
  all[tty] = { label: label || '', ts: Date.now() };
  const trimmed = Object.entries(all)
    .sort((a, b) => b[1].ts - a[1].ts)
    .slice(0, 16);
  writeJson(panesPath(), Object.fromEntries(trimmed));
};

export const readPanes = () =>
  Object.entries(readJson(panesPath(), {}))
    .map(([tty, v]) => ({ tty, label: v.label || '', ts: v.ts || 0 }))
    .sort((a, b) => b.ts - a.ts);

// Per-pane settings: { tts, speaker, voice, volume, tsundere }. Any subset may
// be set (tsundere = a 0–1 baseline level override; null/absent = follow global).
export const readPaneSetting = (tty) => (tty ? readJson(paneVoicesPath(), {})[tty] || {} : {});

// Merge `patch` into the pane's settings; keys set to null are removed; an empty
// entry is deleted entirely.
export const updatePaneSetting = (tty, patch) => {
  if (!tty) return;
  const all = readJson(paneVoicesPath(), {});
  const next = { ...(all[tty] || {}), ...patch };
  for (const k of Object.keys(next)) if (next[k] == null) delete next[k];
  if (Object.keys(next).length === 0) delete all[tty];
  else all[tty] = next;
  writeJson(paneVoicesPath(), all);
};

// --- Config ----------------------------------------------------------------

// Sounds default to OS built-ins so we ship no audio assets (clean repo, no
// licensing). Users can override any of this in config.json.
export const DEFAULT_CONFIG = {
  // Keep the desktop banner even while muted, so you still notice when you
  // come back to your desk during a meeting.
  bannerWhenMuted: true,
  // Spoken read-out of which terminal finished (helps tell tabs apart).
  speak: true,
  // Output volume 0.0–2.0 (1.0 = normal). The menu bar slider / `ai-notify
  // volume` write a state file that overrides this; $AI_NOTIFY_VOLUME overrides
  // per window. Applies to sounds, the spoken voice, and VOICEVOX.
  volume: 1.0,
  // Prefix the window label to the SPOKEN read-out. Off by default — the task
  // gist already identifies the pane, and the label (often the working dir) just
  // adds slow filler. Turn on if you set a short $AI_NOTIFY_LABEL per window.
  // (The desktop banner is always titled with the label regardless.)
  speakLabel: false,
  // Visually highlight the waiting terminal window/pane (best-effort, by tty).
  // Off by default; the color is yellow / orange / red / green / #RRGGBB.
  highlightWaiting: false,
  highlightColor: 'yellow',
  // Make the desktop notification click bring the terminal/IDE forward.
  notifyActivate: true,
  // Speak the agent's full message aloud (Codex's reply, a Claude prompt, the
  // done-summary)? Default false = read only a short gist (first clause, capped
  // at speakMaxChars) — enough to tell which task, never cut off. The full text
  // still shows in the desktop banner. Set true to read the whole thing.
  speakAgentMessage: false,
  speakMaxChars: 40,
  // Optional: translate the agent's message into this language before speaking
  // it (e.g. 'ja'). Empty = off. Key-less, no cost; makes a network request.
  // Toggle with `ai-notify translate on ja` / `off`.
  translateTo: '',
  // Spoken confirmation when you un-mute. Override per language/voice — e.g. a
  // Japanese TTS voice reads the English word more naturally in katakana.
  onMessage: 'notifications on',
  // Global TTS voice for the spoken read-out (macOS `say` voice name, e.g.
  // 'Kyoko'). Empty = OS default voice. Switch it with `ai-notify voice`. A
  // per-provider `voice` below, if set, overrides this for that agent.
  voice: '',
  // TTS backend: 'say' (OS voice) or 'voicevox' (local VOICEVOX engine — speak
  // in character voices). Falls back to 'say' if the engine isn't running.
  // Per window: $AI_NOTIFY_VOICEVOX_SPEAKER overrides the speaker id.
  tts: 'say',
  voicevox: { url: 'http://127.0.0.1:50021', speaker: 3 },
  // Tsundere mode: skin the SPOKEN read-out with a tsundere persona whose
  // harshness (ツン) ⇄ sweetness (デレ) tracks the event's urgency — high-urgency
  // failures get a louder ツン scolding, clean passes get a デレ "good job".
  // Off by default. `level` is the baseline 0 (デレ) – 1 (ツン); the menu bar
  // slider / `ai-notify tsundere level` write a state file that overrides it.
  // With VOICEVOX, the level also picks the character's ツンツン/あまあま style
  // (cached in `styleMap`). No API, no cost — deterministic phrase banks.
  tsundere: {
    enabled: false,
    level: 0.5,
    urgencyShift: true, // modulate the level by the event's urgency
    volumeBoost: true, // louder on high-urgency events
    lang: 'ja', // phrase bank language (ja | en)
    styleMap: null, // { normal, tsun, dere } VOICEVOX style ids; auto-resolved
  },
  // Spoken read-out templates for agent events. The window label is added
  // separately (speakLabel), so leave {label} out here to avoid doubling it.
  // Override per language (e.g. Japanese) in config.json. An agent that supplies
  // its own message (Codex's last reply, a Claude prompt) wins over these.
  doneMessage: 'finished',
  waitingMessage: 'is waiting for input',
  providers: {
    claude: { sound: { waiting: 'Glass', done: 'Hero' }, voice: '' },
    codex: { sound: { done: 'Submarine' }, voice: '' },
    gemini: { sound: { done: 'Ping' }, voice: '' },
    default: { sound: { waiting: 'Glass', done: 'Hero' }, voice: '' },
  },
};

export const readConfig = () => {
  try {
    const raw = JSON.parse(readFileSync(configPath(), 'utf8'));
    return {
      ...DEFAULT_CONFIG,
      ...raw,
      providers: { ...DEFAULT_CONFIG.providers, ...(raw.providers || {}) },
      tsundere: { ...DEFAULT_CONFIG.tsundere, ...(raw.tsundere || {}) },
    };
  } catch {
    return DEFAULT_CONFIG;
  }
};

export const writeConfig = (config) => {
  ensureDir(configDir());
  writeFileSync(configPath(), JSON.stringify(config, null, 2) + '\n');
  return configPath();
};

export const paths = { muteFlagPath, configPath, stateDir, configDir, volumeFlagPath };
