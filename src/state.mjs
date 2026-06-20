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

// Per-pane settings: { tts, speaker, voice, volume }. Any subset may be set.
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
    return { ...DEFAULT_CONFIG, ...raw, providers: { ...DEFAULT_CONFIG.providers, ...(raw.providers || {}) } };
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
