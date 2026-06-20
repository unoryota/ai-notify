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
  // Whether to speak the agent's own text (Codex's reply, a Claude prompt).
  // That text is in the agent's language — set this false to keep every spoken
  // read-out in your own language via doneMessage / waitingMessage instead.
  speakAgentMessage: true,
  // Spoken confirmation when you un-mute. Override per language/voice — e.g. a
  // Japanese TTS voice reads the English word more naturally in katakana.
  onMessage: 'notifications on',
  // Global TTS voice for the spoken read-out (macOS `say` voice name, e.g.
  // 'Kyoko'). Empty = OS default voice. Switch it with `ai-notify voice`. A
  // per-provider `voice` below, if set, overrides this for that agent.
  voice: '',
  // Spoken read-out templates for agent events. `{label}` is the working-dir
  // name. Override per language (e.g. Japanese) in config.json. An agent that
  // supplies its own message (Codex's last reply, a Claude prompt) wins over
  // these.
  doneMessage: '{label} finished',
  waitingMessage: '{label} is waiting for input',
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
