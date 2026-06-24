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
  isWarEnabled,
  readWarLevel,
} from './state.mjs';
import { controllingTty } from './util.mjs';
import { translate } from './translate.mjs';
import { highlightWaiting, clearHighlight } from './highlight.mjs';
import * as voicevox from './voicevox.mjs';
import * as tsundere from './tsundere.mjs';
import * as war from './war.mjs';

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

// Translators lowercase product names ("Claude is waiting…" -> "claude…").
// Restore the canonical casing of the agent names we know about so the
// notification/read-out doesn't read as awkward lowercase Japanese.
const restoreAgentNames = (text) =>
  String(text)
    .replace(/\bclaude\b/gi, 'Claude')
    .replace(/\bcodex\b/gi, 'Codex')
    .replace(/\bgemini\b/gi, 'Gemini');

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
// `alert` (default true) gates whether this event actually makes noise — sound,
// spoken read-out, banner, highlight, and the waiting popup. When false the call
// still keeps the pane/waiting state correct (so a suppressed "done" still clears
// a popup), it just stays silent. The hook decides `alert` from the per-kind
// notification toggles.
export const emit = ({ provider = 'default', event = 'done', label = '', message = '', alert = true }) => {
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
  // Translation lowercases product names ("Claude" -> "claude"); restore the
  // well-known agent names so banners and read-outs read correctly.
  fullBody = restoreAgentNames(fullBody);
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
  // waiting -> yellow menu bar status (+ the popup); done clears it. A suppressed
  // (alert=false) waiting must NOT light up the popup, so only set it when alert.
  // "done" always clears regardless of alert. Pass the reason text for filtering.
  setPaneWaiting(tty, event === 'waiting' && alert, event === 'waiting' ? message || fromTemplate : '');
  const pane = readPaneSetting(tty);

  // Name this pane in the read-out, most-reliable identity first:
  //   1. $AI_NOTIFY_LABEL — set in the pane's shell, inherited by the hook even
  //      when the agent runs it detached (no tty). Always spoken: setting it is
  //      explicit intent. The reliable way to name a pane for Claude Code.
  //   2. pane.speakName — set from the menu bar, keyed by tty. Works only when
  //      the hook resolves to the pane's tty (see controllingTty's tree walk).
  //   3. the auto-derived label — only when speakLabel is on (else slow filler).
  const envName = (process.env.AI_NOTIFY_LABEL || '').trim();
  const spokenName = envName || pane.speakName || (config.speakLabel === true && label ? label : '');
  // Join the pane name to the read-out as a vocative ("ジョン、…"). We use a bare
  // comma 「、」 — NOT the topic particle 「は/わ」: the body is usually a full
  // sentence that already carries its own subject (e.g. translated "Claudeは
  // あなたの入力を待っています"), so adding the name as a second topic
  // ("ジョンわ、Claudeは…") reads as awkward double-topic Japanese. A comma after
  // the name avoids that and reads naturally. Other languages get a comma too.
  const isJa = (s) => /[぀-ヿ㐀-鿿ｦ-ﾟ]/.test(s); // kana / kanji / half-width kana
  const joinName = (name, body) => (name ? `${name}${isJa(body) ? '、' : ', '}${body}` : body);
  const speakText = joinName(spokenName, spokenBody);

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

  // Read-out "skin". Two bipolar axes, each a master ON/OFF toggle + a slider
  // whose CENTER (0.5) is OFF; the further from center, the stronger:
  //   ツンデレ      : 左 ツン(極寒) … 中央 off … 右 デレ(デレデレ)
  //   心理的安全性 : 左 ブラック企業 … 中央 off … 右 ホワイト企業/優しい
  // 心理的安全性 takes precedence when on; otherwise ツンデレ skins it.
  let outText = speakText;
  let outVol = vol;
  let outSpeaker = speaker;
  let speakTone = 'normal';
  let warActive = false;
  const ts = config.tsundere || {};
  const tier = tsundere.classifyUrgency(event, message, fullBody);

  // Levels, per-pane first (env > pane > file > config). 0.5 = off.
  const tsLevel = (() => {
    const envLevel = parseFloat(process.env.AI_NOTIFY_TSUNDERE_LEVEL);
    if (Number.isFinite(envLevel)) return Math.min(1, Math.max(0, envLevel));
    if (typeof pane.tsundere === 'number') return pane.tsundere;
    const f = readTsundereLevel();
    if (f != null) return f;
    return typeof ts.level === 'number' ? ts.level : 0.5; // 0.5 = off (center)
  })();
  // Two independent BIPOLAR read-out skins, each with a CENTER (0.5) = OFF and a
  // master ON/OFF toggle (config.tsundere.enabled / isWarEnabled):
  //   ツンデレ      : 左 ツン(極寒) ⇔ 中央OFF ⇔ 右 デレ(デレデレ)
  //   心理的安全性 : 左 ブラック企業 ⇔ 中央OFF ⇔ 右 ホワイト企業/優しい
  // When 心理的安全性 is on it's the read-out skin — but it COMBINES with ツンデレ:
  // the psafety SIDE (black/white) is the environment and the tsundere TONE
  // (ツン/デレ/ノーマル) flavors the line, so ブラック×デレ ≠ ブラック×ツン. When ツンデレ
  // is off the tone is ノーマル. If 心理的安全性 is off, ツンデレ skins it alone.
  const warSlider = typeof pane.war === 'number' ? pane.war : readWarLevel();
  const psafetyOn = isWarEnabled() && !war.isOff(warSlider);
  const tsundereOn = ts.enabled === true && !tsundere.isTsundereOff(tsLevel);
  const tsStyle = tsundere.axisFor(tsLevel);

  if (psafetyOn) {
    warActive = true;
    // The word tone follows ツンデレ when it's on — using the SAME 5-step scale as
    // tsundere (cold/tsun/normal/dere/deredere) so ツン100% maps to the icy `cold`
    // cell with NO hidden デレ. Otherwise the side's own default (black→ツン/white→デレ).
    const wordTone = tsundereOn
      ? (() => {
          const pt = tsundere.phraseTone(tsLevel); // cold|tsun|normal|dere|deredere
          return pt === 'deredere' ? 'dere' : pt; // war banks: cold|tsun|normal|dere
        })()
      : war.styleFor(warSlider);
    // VOICEVOX style only knows tsun/dere/normal — cold speaks in the ツン voice.
    speakTone = wordTone === 'cold' ? 'tsun' : wordTone;
    outVol = Math.min(2, Math.max(0, vol * war.volumeMul(warSlider, tier)));
    outText = war.wrap(spokenBody, warSlider, tier, ts.lang || 'ja', nextCounter('war'), wordTone);
    if (spokenName) outText = joinName(spokenName, outText);
    if (tts === 'voicevox') {
      const sm = ts.styleMap || voicevox.resolveStyles(outSpeaker, config.voicevox?.url);
      if (sm && sm[speakTone] != null) outSpeaker = sm[speakTone];
    }
  } else if (tsundereOn) {
    speakTone = tsStyle;
    outVol = Math.min(2, Math.max(0, vol * tsundere.volumeMul(tier, ts.volumeBoost !== false)));
    outText = tsundere.wrap(spokenBody, tsLevel, tier, ts.lang || 'ja', nextCounter('tsundere'));
    if (spokenName) outText = joinName(spokenName, outText);
    if (tts === 'voicevox') {
      const sm = ts.styleMap || voicevox.resolveStyles(outSpeaker, config.voicevox?.url);
      if (sm && sm[speakTone] != null) outSpeaker = sm[speakTone];
    }
  }

  if (alert && !muted) {
    playSound(soundName, outVol);
    if (config.speak && outVol > 0) {
      let spoken = false;
      if (tts === 'voicevox') {
        // Base prosody: global, with this pane's per-pane overrides on top.
        const baseProsody = { ...readVoiceProsody(), ...(pane.prosody || {}) };
        let prosody = tsundere.effectiveProsody(speakTone, baseProsody);
        if (warActive) prosody = war.effectiveProsody(warSlider, prosody); // 心理的安全性 scale on top
        spoken = voicevox.speak(outText, outSpeaker, config.voicevox?.url, outVol, undefined, prosody);
      }
      if (!spoken) speak(outText, voice, outVol, speakTone); // OS `say` (also the VOICEVOX fallback)
    }
  }

  // MUTE MEANS SILENT. We post a desktop banner only when NOT muted — macOS plays
  // its own notification ping for any banner we post (the sound is the user's
  // Notification Center setting, which we can't suppress per-notification), so a
  // banner-while-muted would leak a "通知音" even though the spoken read-out is off.
  // While muted the silent cues still show which pane waits: the menu bar turns
  // yellow and the waiting window gets highlighted (both below, ungated by sound).
  if (alert && !muted) {
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
  if (alert && config.highlightWaiting) {
    try {
      if (event === 'waiting') highlightWaiting(label, config.highlightColor);
      else if (event === 'done') clearHighlight();
    } catch {
      /* visual is best-effort */
    }
  }
};
