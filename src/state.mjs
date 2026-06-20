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

// --- Config ----------------------------------------------------------------

// Sounds default to OS built-ins so we ship no audio assets (clean repo, no
// licensing). Users can override any of this in config.json.
export const DEFAULT_CONFIG = {
  // Keep the desktop banner even while muted, so you still notice when you
  // come back to your desk during a meeting.
  bannerWhenMuted: true,
  // Spoken read-out of which terminal finished (helps tell tabs apart).
  speak: true,
  // Prefix the window label to the spoken message so you can tell which of many
  // terminals is asking (set a short per-window name with $AI_NOTIFY_LABEL).
  speakLabel: true,
  // Visually highlight the waiting terminal window/pane (best-effort, by tty).
  // Off by default; the color is yellow / orange / red / green / #RRGGBB.
  highlightWaiting: false,
  highlightColor: 'yellow',
  // Make the desktop notification click bring the terminal/IDE forward.
  notifyActivate: true,
  // Speak the agent's full message aloud (Codex's reply, a Claude prompt, the
  // done-summary)? Default false = the read-out stays short ("<label> finished")
  // so it never gets cut off; the full text still shows in the desktop banner.
  // Set true to read the whole thing aloud.
  speakAgentMessage: false,
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

export const paths = { muteFlagPath, configPath, stateDir, configDir };
