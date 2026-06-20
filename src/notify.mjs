// Cross-platform notifier: sound + spoken read-out + desktop banner.
//
// Every emitter is best-effort and degrades silently when a backend is missing,
// so a Linux box without `notify-send` (or a Mac without `terminal-notifier`)
// never errors — it just does what it can.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isMuted, readConfig } from './state.mjs';
import { translate } from './translate.mjs';
import { highlightWaiting, clearHighlight } from './highlight.mjs';
import * as voicevox from './voicevox.mjs';

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

const playSound = (name) => {
  const sound = resolveSound(name);
  if (platform === 'darwin') {
    if (sound && existsSync(sound)) {
      // play twice, a touch louder, so it is hard to miss
      run('afplay', ['-v', '2', sound]);
      run('afplay', ['-v', '2', sound]);
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

const speak = (text, voice) => {
  if (!text) return;
  if (platform === 'darwin') {
    run('say', voice ? ['-v', voice, text] : [text]);
  } else if (platform === 'linux') {
    if (which('spd-say')) run('spd-say', [text]);
    else if (which('espeak')) run('espeak', [text]);
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
  // Spoken read-out — keep it SHORT: just the window label + the event, so you
  // know *which* terminal needs you. Reading a long summary aloud gets cut off
  // (and slows synthesis). Opt into reading the full message with
  // speakAgentMessage:true.
  const spokenBody = config.speakAgentMessage && message ? fullBody : fromTemplate || fallback;
  const speakText = config.speakLabel !== false && label ? `${label}、${spokenBody}` : spokenBody;

  // Voice precedence (most specific first):
  //   $AI_NOTIFY_VOICE  — set per terminal window/pane to give each its own voice
  //   provider voice    — per agent (Claude vs Codex)
  //   global voice      — the single `ai-notify voice` switch
  const voice = process.env.AI_NOTIFY_VOICE || p.voice || config.voice;

  if (!muted) {
    playSound(soundName);
    if (config.speak) {
      let spoken = false;
      if (config.tts === 'voicevox') {
        const speaker = process.env.AI_NOTIFY_VOICEVOX_SPEAKER || config.voicevox?.speaker;
        spoken = voicevox.speak(speakText, speaker, config.voicevox?.url);
      }
      if (!spoken) speak(speakText, voice); // OS `say` (also the VOICEVOX fallback)
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
