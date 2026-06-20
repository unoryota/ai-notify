// Cross-platform notifier: sound + spoken read-out + desktop banner.
//
// Every emitter is best-effort and degrades silently when a backend is missing,
// so a Linux box without `notify-send` (or a Mac without `terminal-notifier`)
// never errors — it just does what it can.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isMuted, readConfig } from './state.mjs';

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

const banner = (title, subtitle, message) => {
  if (platform === 'darwin') {
    if (which('terminal-notifier')) {
      run('terminal-notifier', ['-title', title, '-subtitle', subtitle, '-message', message]);
    } else {
      const esc = (s) => String(s).replace(/"/g, '\\"');
      run('osascript', ['-e', `display notification "${esc(message)}" with title "${esc(title)}" subtitle "${esc(subtitle)}"`]);
    }
  } else if (platform === 'linux') {
    if (which('notify-send')) run('notify-send', [`${title}: ${subtitle}`, message]);
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
  const speakText = message || fromTemplate || (event === 'waiting' ? 'is waiting for input' : 'finished');

  // Voice precedence (most specific first):
  //   $AI_NOTIFY_VOICE  — set per terminal window/pane to give each its own voice
  //   provider voice    — per agent (Claude vs Codex)
  //   global voice      — the single `ai-notify voice` switch
  const voice = process.env.AI_NOTIFY_VOICE || p.voice || config.voice;

  if (!muted) {
    playSound(soundName);
    if (config.speak) speak(speakText, voice);
  }

  if (!muted || config.bannerWhenMuted) {
    const title = 'AI Notify';
    banner(title, label || provider, message || speakText);
  }
};
