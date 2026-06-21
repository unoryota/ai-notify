// VOICEVOX read-out: synthesize the spoken notification with a local VOICEVOX
// engine (free, offline, no API key) so each terminal can speak in a distinct
// character voice (ずんだもん, 四国めたん, …).
//
// The engine exposes an HTTP API on 127.0.0.1:50021. We use `curl` (zero deps):
//   POST /audio_query?speaker=ID&text=...   -> query JSON
//   POST /synthesis?speaker=ID  (query body) -> WAV
// then play the WAV. Everything is best-effort: if the engine isn't running we
// return false and the caller falls back to the OS `say` voice.

import { execSync, execFileSync } from 'node:child_process';
import { existsSync, statSync, mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { stateDir } from './state.mjs';

export const DEFAULT_URL = 'http://127.0.0.1:50021';
export const DOWNLOAD_URL = 'https://voicevox.hiroshiba.jp/';

const platform = process.platform;

const sleep = (ms) => {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    /* SharedArrayBuffer unavailable — skip the wait */
  }
};

// Is the VOICEVOX app installed (macOS)?
export const appInstalled = () => {
  if (platform !== 'darwin') return false;
  return ['/Applications/VOICEVOX.app', join(homedir(), 'Applications/VOICEVOX.app')].some((p) => existsSync(p));
};

export const launchApp = () => {
  try {
    if (platform === 'darwin') execFileSync('open', ['-a', 'VOICEVOX']);
  } catch {
    /* ignore */
  }
};

export const openDownloadPage = () => {
  try {
    if (platform === 'darwin') execFileSync('open', [DOWNLOAD_URL]);
    else if (platform === 'linux') execFileSync('xdg-open', [DOWNLOAD_URL]);
  } catch {
    /* ignore */
  }
};

// Poll until the engine answers, or timeout.
export const waitForEngine = (url = DEFAULT_URL, timeoutMs = 40000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isAvailable(url, 1500)) return true;
    sleep(2000);
  }
  return false;
};

// Record why a synthesis fell back to the OS voice, so intermittent fallbacks
// are diagnosable instead of silent. Best-effort.
const logFail = (reason) => {
  try {
    appendFileSync(join(stateDir(), 'voicevox.log'), `${new Date().toISOString()} ${reason}\n`);
  } catch {
    /* ignore */
  }
};

export const isAvailable = (url = DEFAULT_URL, timeoutMs = 1500) => {
  try {
    const out = execFileSync('curl', ['-s', '-m', String(Math.ceil(timeoutMs / 1000)), `${url}/version`], {
      encoding: 'utf8',
      timeout: timeoutMs + 500,
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
};

// Flatten /speakers into [{ id, name }] (character + style).
export const listSpeakers = (url = DEFAULT_URL) => {
  try {
    const out = execFileSync('curl', ['-s', '-m', '4', `${url}/speakers`], { encoding: 'utf8', timeout: 5000 });
    const data = JSON.parse(out);
    const rows = [];
    for (const sp of data) {
      for (const st of sp.styles || []) rows.push({ id: st.id, name: `${sp.name}（${st.name}）` });
    }
    return rows;
  } catch {
    return [];
  }
};

// One entry per character (preferring the ノーマル style) — a short, pickable
// list for the menu bar, vs the full style list from listSpeakers.
export const listCharacters = (url = DEFAULT_URL) => {
  try {
    const out = execFileSync('curl', ['-s', '-m', '4', `${url}/speakers`], { encoding: 'utf8', timeout: 5000 });
    const data = JSON.parse(out);
    const rows = [];
    for (const sp of data) {
      const styles = sp.styles || [];
      const pick = styles.find((s) => s.name === 'ノーマル') || styles[0];
      if (pick) rows.push({ id: pick.id, name: sp.name });
    }
    return rows;
  } catch {
    return [];
  }
};

const playWav = (wav, vol = 1) => {
  if (platform === 'darwin') execFileSync('afplay', ['-v', String(vol), wav], { timeout: 30000 });
  else if (platform === 'linux') {
    try {
      execFileSync('aplay', ['-q', wav], { timeout: 30000 });
    } catch {
      execFileSync('paplay', [wav], { timeout: 30000 });
    }
  }
};

// Synthesize and play. Returns true if it spoke, false to fall back to `say`.
export const speak = (text, speaker = 3, url = DEFAULT_URL, vol = 1, timeoutMs = 15000) => {
  if (!text) return false;
  let dir;
  try {
    dir = mkdtempSync(join(tmpdir(), 'ai-notify-vv-'));
    const wav = join(dir, 'v.wav');
    const sec = String(Math.max(2, Math.ceil(timeoutMs / 1000)));
    const enc = encodeURIComponent(text); // URL-encoded -> no shell metacharacters
    // Pipe audio_query straight into synthesis. execSync uses /bin/sh for the pipe.
    const cmd =
      `curl -s -m ${sec} -X POST "${url}/audio_query?speaker=${speaker}&text=${enc}" | ` +
      `curl -s -m ${sec} -X POST -H "Content-Type: application/json" -d @- ` +
      `"${url}/synthesis?speaker=${speaker}" -o "${wav}"`;
    execSync(cmd, { timeout: timeoutMs + 1000, stdio: 'ignore' });
    if (!existsSync(wav) || statSync(wav).size < 1000) {
      logFail(`empty/short wav (speaker ${speaker}, ${text.length} chars)`);
      return false;
    }
    playWav(wav, vol);
    return true;
  } catch (e) {
    logFail(`error (speaker ${speaker}): ${(e && e.message) || e}`);
    return false;
  } finally {
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
};
