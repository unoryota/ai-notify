// Cross-platform notifier: sound + spoken read-out + desktop banner.
//
// Every emitter is best-effort and degrades silently when a backend is missing,
// so a Linux box without `notify-send` (or a Mac without `terminal-notifier`)
// never errors — it just does what it can.

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isMuted,
  readConfig,
  readVolume,
  recordPane,
  readPaneSetting,
  setPaneWaiting,
  readTsundereLevel,
  readVoiceProsody,
  nextCounter,
} from './state.mjs';
import { controllingTty } from './util.mjs';
import { translate } from './translate.mjs';
import { highlightWaiting, clearHighlight } from './highlight.mjs';
import * as voicevox from './voicevox.mjs';
import * as tsundere from './tsundere.mjs';

const platform = process.platform; // 'darwin' | 'linux' | 'win32'

const run = (cmd, args) => {
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: false });
    child.on('error', () => {}); // missing binary -> ignore
  } catch {
    /* ignore */
  }
};

const which = (bin) =>
  (process.env.PATH || '')
    .split(':')
    .some((dir) => dir && existsSync(`${dir}/${bin}`));

// Resolve a configured sound name to something the OS can play.
const resolveSound = (name) => {
  if (!name) return null;
  if (name.includes('/')) return name; // already an absolute/relative path
  if (platform === 'darwin') return `/System/Library/Sounds/${name}.aiff`;
  return name; // linux/win: treated as a freedesktop event id / ignored
};

const playSound = (name, vol = 1) => {
  const sound = resolveSound(name);
  if (platform === 'darwin') {
    if (sound && existsSync(sound)) {
      // play twice, a touch louder, so it is hard to miss
      const v = String(2 * vol);
      run('afplay', ['-v', v, sound]);
      run('afplay', ['-v', v, sound]);
    }
  } else if (platform === 'linux') {
    if (which('paplay') && existsSync('/usr/share/sounds/freedesktop/stereo/complete.oga')) {
      run('paplay', ['/usr/share/sounds/freedesktop/stereo/complete.oga']);
    } else if (which('canberra-gtk-play')) {
      run('canberra-gtk-play', ['-i', 'complete']);
    } else if (which('aplay')) {
      run('aplay', ['-q', '/usr/share/sounds/alsa/Front_Center.wav']);
    }
  } else if (platform === 'win32') {
    run('powershell', ['-NoProfile', '-Command', '[console]::beep(880,200)']);
  }
};

// `say` has no per-call volume, so when a non-default volume is set we render to
// a file and play it through afplay at the requested level.
const sayWithVolume = (text, voice, vol) => {
  try {
    const tmp = join(tmpdir(), `ai-notify-say-${process.pid}.aiff`);
    execFileSync('say', voice ? ['-v', voice, '-o', tmp, text] : ['-o', tmp, text], { timeout: 30000 });
    execFileSync('afplay', ['-v', String(vol), tmp], { timeout: 30000 });
    rmSync(tmp, { force: true });
  } catch {
    /* ignore */
  }
};

const speak = (text, voice, vol = 1, tone = 'normal') => {
  if (!text) return;
  if (platform === 'darwin') {
    // Give the OS voice human contour (pace/pitch/intonation + real pauses)
    // instead of a flat 棒読み monotone.
    const t = tsundere.decorateForSay(text, tone);
    if (vol !== 1) return sayWithVolume(t, voice, vol);
    run('say', voice ? ['-v', voice, t] : [t]);
  } else if (platform === 'linux') {
    const e = tsundere.prosodyFor(tone).espeak;
    if (which('spd-say')) {
      const r = Math.max(-100, Math.min(100, Math.round((e.speed - 175) / 1.5)));
      const pch = Math.max(-100, Math.min(100, Math.round((e.pitch - 50) * 2)));
      run('spd-say', ['-r', String(r), '-p', String(pch), text]);
    } else if (which('espeak')) {
      run('espeak', ['-p', String(e.pitch), '-s', String(e.speed), text]);
    }
  } else if (platform === 'win32') {
    run('powershell', [
      '-NoProfile',
      '-Command',
      `Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('${text.replace(/'/g, '')}')`,
    ]);
  }
};

const banner = (title, subtitle, message, { activate, urgent } = {}) => {
  if (platform === 'darwin') {
    if (which('terminal-notifier')) {
      const args = ['-title', title, '-subtitle', subtitle, '-message', message];
      if (activate) args.push('-activate', activate); // click the notification -> focus the app
      run('terminal-notifier', args);
    } else {
      const esc = (s) => String(s).replace(/"/g, '\\"');
      run('osascript', [
        '-e',
        `display notification "${esc(message)}" with title "${esc(title)}" subtitle "${esc(subtitle)}"`,
      ]);
    }
  } else if (platform === 'linux') {
    if (which('notify-send')) {
      const args = urgent ? ['-u', 'critical'] : [];
      run('notify-send', [...args, `${title}: ${subtitle}`, message]);
    }
  }
  // win32: skipped (no dependency-free toast); sound/voice still fire.
};

// A short, speakable gist of a summary: the first sentence, capped at `max`
// characters on a clause boundary — enough to tell which task, not a monologue.
const shortenForSpeech = (text, max = 40) => {
  let s = String(text).replace(/\s+/g, ' ').trim();
  s = (s.split(/[。.!?！？\n]/)[0] || s).trim(); // first sentence
  if (s.length <= max) return s.replace(/[、,\s]+$/, '');
  const cut = s.slice(0, max);
  const ten = cut.lastIndexOf('、'); // prefer a clause boundary
  const sep = ten > max * 0.4 ? ten : cut.lastIndexOf(' ');
  return (sep > 0 ? cut.slice(0, sep) : cut).replace(/[、,\s]+$/, '').trim();
};

// Public entry. Called by the hook handler with already-parsed fields.
export const emit = ({ provider = 'default', event = 'done', label = '', message = '' }) => {
  const config = readConfig();
  const muted = isMuted();
  const p = config.providers[provider] || config.providers.default;

  const soundName = (p.sound && (p.sound[event] || p.sound.done)) || null;
  const template = (event === 'waiting' ? config.waitingMessage : config.doneMessage) || '';
  const fromTemplate = template.replace(/\{label\}/g, label).replace(/\s+/g, ' ').trim();
  const fallback = event === 'waiting' ? 'is waiting for input' : 'finished';
  // The agent's own text (Codex's reply, a Claude prompt) is in the agent's
  // language — often English — not necessarily the user's. Three modes:
  //   speakAgentMessage:false  -> never speak it; use the localized template.
  //   translateTo set          -> translate it into your language, speak that
  //                               (falling back to the template on failure).
  //   default                  -> speak the raw message as-is.
  // The desktop banner always shows the full original message visually.
  // Full text for the desktop banner — the translated summary / message. Length
  // is fine here: a banner never gets cut off and you read it at a glance.
  let fullBody;
  if (message) {
    fullBody = (config.translateTo ? translate(message, config.translateTo) : message) || fromTemplate || fallback;
  } else {
    fullBody = fromTemplate || fallback;
  }
  // Spoken read-out — short enough not to get cut off, but enough to identify
  // WHICH task: the window label + a short gist of what happened (the first
  // clause of the summary). speakAgentMessage:true reads the whole thing.
  let spokenBody;
  if (!message) spokenBody = fromTemplate || fallback;
  else if (config.speakAgentMessage) spokenBody = fullBody;
  else spokenBody = shortenForSpeech(fullBody, config.speakMaxChars || 40);
  // Per-pane settings (voice / volume / tsundere / name), keyed by tty. Read
  // here — before the read-out is assembled — so the spoken text can use this
  // pane's assigned name. Also remember the pane so the menu bar can list it.
  const tty = controllingTty();
  recordPane(tty, label);
  setPaneWaiting(tty, event === 'waiting'); // waiting -> yellow menu bar status; done clears it
  const pane = readPaneSetting(tty);

  // Name this pane in the read-out. An explicit per-pane name (set from the menu
  // bar) is ALWAYS spoken; the auto-derived label (often just the working dir)
  // is prefixed only when speakLabel is on — it's slow filler otherwise.
  const spokenName = pane.speakName || (config.speakLabel === true && label ? label : '');
  const speakText = spokenName ? `${spokenName}、${spokenBody}` : spokenBody;

  // Per-pane voice (precedence: $AI_NOTIFY_* env > this pane's pick > global).
  const tts = pane.tts || config.tts;
  const voice = process.env.AI_NOTIFY_VOICE || pane.voice || p.voice || config.voice;
  const speaker = process.env.AI_NOTIFY_VOICEVOX_SPEAKER || pane.speaker || config.voicevox?.speaker;

  // Volume (0–2): per-window env > this pane's slider > the global slider /
  // `ai-notify volume` > config.
  const envVol = parseFloat(process.env.AI_NOTIFY_VOLUME);
  const fileVol = readVolume();
  const vol = Number.isFinite(envVol)
    ? Math.min(2, Math.max(0, envVol))
    : typeof pane.volume === 'number'
      ? pane.volume
      : fileVol != null
        ? fileVol
        : typeof config.volume === 'number'
          ? config.volume
          : 1;

  // Tsundere mode: skin the spoken text, scale volume, and (with VOICEVOX) pick
  // the character's ツンツン/あまあま style — all driven by the event's urgency.
  // The banner is left untouched (it stays factual). Off => identical to before.
  let outText = speakText;
  let outVol = vol;
  let outSpeaker = speaker;
  let speakTone = 'normal'; // delivery contour; tsundere sets it to tsun/dere
  const ts = config.tsundere;
  if (ts && ts.enabled) {
    const tier = tsundere.classifyUrgency(event, message, fullBody);
    const envLevel = parseFloat(process.env.AI_NOTIFY_TSUNDERE_LEVEL);
    const baseLevel = Number.isFinite(envLevel)
      ? Math.min(1, Math.max(0, envLevel))
      : typeof pane.tsundere === 'number'
        ? pane.tsundere
        : readTsundereLevel() != null
          ? readTsundereLevel()
          : typeof ts.level === 'number'
            ? ts.level
            : 0.5;
    const eff = tsundere.effectiveLevel(baseLevel, tier, ts.urgencyShift !== false);
    speakTone = tsundere.axisFor(eff);
    outVol = Math.min(2, Math.max(0, vol * tsundere.volumeMul(tier, ts.volumeBoost !== false)));
    outText = tsundere.wrap(spokenBody, eff, tier, ts.lang || 'ja', nextCounter('tsundere'));
    if (spokenName) outText = `${spokenName}、${outText}`;
    if (tts === 'voicevox') {
      const sm = ts.styleMap || voicevox.resolveStyles(outSpeaker, config.voicevox?.url);
      const axis = tsundere.axisFor(eff);
      if (sm && sm[axis] != null) outSpeaker = sm[axis];
    }
  }

  if (!muted) {
    playSound(soundName, outVol);
    if (config.speak && outVol > 0) {
      let spoken = false;
      if (tts === 'voicevox') {
        const prosody = tsundere.effectiveProsody(speakTone, readVoiceProsody());
        spoken = voicevox.speak(outText, outSpeaker, config.voicevox?.url, outVol, undefined, prosody);
      }
      if (!spoken) speak(outText, voice, outVol, speakTone); // OS `say` (also the VOICEVOX fallback)
    }
  }

  if (!muted || config.bannerWhenMuted) {
    const waiting = event === 'waiting';
    banner(
      waiting ? `⏳ ${label || 'input'}` : `✓ ${label || 'done'}`,
      waiting ? 'waiting for input' : '',
      fullBody,
      {
        // Click the notification to bring the waiting app (e.g. the IDE) forward.
        activate: config.notifyActivate !== false ? process.env.__CFBundleIdentifier : undefined,
        urgent: waiting,
      }
    );
  }

  // Visual highlight of *this* terminal window so a waiting pane stands out
  // among many. Always best-effort, and applied even when muted (you still want
  // to see which window needs you during a meeting).
  if (config.highlightWaiting) {
    try {
      if (event === 'waiting') highlightWaiting(label, config.highlightColor);
      else if (event === 'done') clearHighlight();
    } catch {
      /* visual is best-effort */
    }
  }
};
