#!/usr/bin/env node
// ai-notify — desktop/sound notifications for terminal AI coding agents.
// One mute switch for all of them, across every terminal. No daemon.

import { readFileSync } from 'node:fs';
import { execSync, execFileSync } from 'node:child_process';
import { providers, byId } from './providers/index.mjs';
import { emit } from './notify.mjs';
import { deriveLabel, cliInvocation, isEphemeralInstall, controllingTty } from './util.mjs';
import { curatedVoices, resolveVoice, previewVoice } from './voices.mjs';
import * as menubar from './menubar.mjs';
import { translate } from './translate.mjs';
import { diagnose as highlightDiagnose, clearHighlight } from './highlight.mjs';
import * as voicevox from './voicevox.mjs';
import * as tsundere from './tsundere.mjs';
import {
  isMuted,
  setMuted,
  toggleMuted,
  readConfig,
  writeConfig,
  paths,
  DEFAULT_CONFIG,
  readVolume,
  setVolume,
  readTsundereLevel,
  setTsundereLevel,
  readVoiceProsody,
  setVoiceProsody,
  resetVoiceProsody,
  VOICE_PROSODY_RANGE,
  readPanes,
  readPaneSetting,
  updatePaneSetting,
  firstRunNudge,
  isPopupEnabled,
  setPopupEnabled,
  getPopupImage,
  setPopupImage,
  getPopupDelay,
  setPopupDelay,
  getPopupIgnore,
  setPopupIgnore,
} from './state.mjs';
import { resolve as resolvePath } from 'node:path';

// Single source of truth: read the version from package.json so `--version`
// (and the Homebrew formula test that checks it) always matches the release.
const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const args = process.argv.slice(2);
const cmd = args[0];

// Tiny flag parser: --key value / --flag
const opt = (name, fallback = undefined) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = args[i + 1];
  return next && !next.startsWith('--') ? next : true;
};
const positionals = args.slice(1).filter((a) => !a.startsWith('--'));

const log = (...m) => console.log(...m);
const onlyFilter = () => {
  const only = opt('only');
  return typeof only === 'string' ? only.split(',').map((s) => s.trim()) : null;
};
const selected = () => {
  const only = onlyFilter();
  return providers.filter((p) => (only ? only.includes(p.id) : true));
};

const readStdinJson = () => {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
};

// Pull the agent's last assistant text from a Claude Code transcript (JSONL),
// trimmed to a short summary suitable for a notification / read-out.
const lastAssistantText = (transcriptPath) => {
  try {
    const lines = readFileSync(transcriptPath, 'utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (obj.type !== 'assistant') continue;
      const content = obj.message?.content;
      if (!Array.isArray(content)) continue;
      const text = content
        .filter((c) => c?.type === 'text' && c.text)
        .map((c) => c.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) return text.length > 140 ? `${text.slice(0, 140)}…` : text;
    }
  } catch {
    /* unreadable transcript — fall back to the template */
  }
  return '';
};

// Terminals (ttys) currently running a wired agent — so all open panes can be
// assigned a voice from the menu bar without first firing a notification.
const livePanes = () => {
  try {
    const out = execSync('ps -Ao tty=,command=', { encoding: 'utf8', maxBuffer: 1 << 22 });
    const ttys = new Set();
    for (const line of out.split('\n')) {
      const m = line.match(/^(\S+)\s+(.*)$/);
      if (!m) continue;
      const [, tty, cmd] = m;
      if (tty === '??' || tty === '?') continue;
      if (/ai-notify|menubar/.test(cmd)) continue; // skip our own hook/agent
      if (/\bclaude\b|\bcodex\b|\bgemini\b/i.test(cmd)) ttys.add(`/dev/${tty}`);
    }
    return [...ttys];
  } catch {
    return [];
  }
};

const cmds = {
  init() {
    const dryRun = !!opt('dry-run');
    const { node, cliPath } = cliInvocation();
    if (isEphemeralInstall(cliPath)) {
      log('⚠  Running from a temporary npx cache. Hooks need a persistent install.');
      log('   Install first:  npm i -g ai-notify   then:  ai-notify init\n');
    }
    log(dryRun ? 'Preview (no changes written):\n' : 'Wiring detected agents:\n');
    let any = false;
    for (const p of selected()) {
      if (!p.detect()) continue;
      any = true;
      const r = p.wire({ node, cliPath, dryRun });
      const icon = r.skipped ? '⚠ ' : r.changed ? '✓ ' : '· ';
      log(`  ${icon}${p.displayName}: ${r.detail}`);
    }
    if (!any) log('  No supported agents detected (looked for Claude Code, Codex, Gemini).');
    log(`\nMute toggle:  ai-notify toggle    Status:  ai-notify status`);
    if (!dryRun) {
      log('Restart already-running Codex sessions to pick up the change.');
      // A quiet, one-time nudge — `init` is a setup command, run once. Shown
      // only on the first successful wiring so it never nags on re-runs.
      if (any && firstRunNudge()) {
        log('\n⭐ Useful? A GitHub star really helps it reach others:');
        log('   https://github.com/unoryota/ai-notify');
      }
    }
  },

  uninstall() {
    const dryRun = !!opt('dry-run');
    log('Removing ai-notify wiring:\n');
    for (const p of selected()) {
      const r = p.unwire({ dryRun });
      log(`  ${r.changed ? '✓ ' : '· '}${p.displayName}: ${r.detail}`);
    }
  },

  on() { setMuted(false); log('🔔 notifications ON'); emitConfirm(); },
  off() { setMuted(true); log('🔕 notifications OFF (muted)'); },
  toggle() {
    const muted = toggleMuted();
    log(muted ? '🔕 notifications OFF (muted)' : '🔔 notifications ON');
    if (!muted) emitConfirm();
  },
  status() {
    // Compact forms for embedding in menu bars, prompts, tmux, and the
    // Claude Code statusline — where you can't type a command but want the
    // state always visible.
    if (opt('icon')) return log(isMuted() ? '🔕' : '🔔');
    if (opt('plain')) return log(isMuted() ? 'muted' : 'on');

    log(`notifications: ${isMuted() ? '🔕 OFF (muted)' : '🔔 ON'}`);
    log(`flag:   ${paths.muteFlagPath()}`);
    log(`config: ${paths.configPath()}\n`);
    for (const p of providers) {
      const s = p.status();
      if (!s.installed) continue;
      log(`  ${p.displayName.padEnd(14)} ${s.wired ? '✓ wired' : '✗ not wired'}`);
    }
  },

  doctor() {
    log(`ai-notify ${VERSION}  (node ${process.version}, ${process.platform})\n`);
    const { cliPath } = cliInvocation();
    if (isEphemeralInstall(cliPath)) log('⚠  ephemeral npx install — run `npm i -g ai-notify` for hooks to persist.\n');
    log('Agents:');
    for (const p of providers) {
      const s = p.status();
      log(`  ${p.displayName.padEnd(14)} ${!s.installed ? '— not installed' : s.wired ? '✓ wired' : '✗ detected, not wired'}`);
    }
  },

  config() {
    if (positionals[0] === 'init') {
      const file = writeConfig(readConfig());
      log(`wrote ${file}`);
    } else {
      log(JSON.stringify(readConfig(), null, 2));
    }
  },

  // Pick the spoken read-out voice from the machine's built-in `say` voices.
  // Offline, free, no API. Different voice per task = tell terminals apart.
  voice() {
    const sub = positionals[0];
    const config = readConfig();
    const list = curatedVoices(10);
    const sample =
      (config.doneMessage || 'finished').replace(/\{label\}/g, 'ai-notify').replace(/\s+/g, ' ').trim() ||
      'finished';

    const setVoice = (name) => {
      config.voice = name; // '' = OS default
      config.tts = 'say'; // choosing a system voice switches the backend off VOICEVOX
      // Global voice wins only if no per-provider override; clear them so the
      // single switch actually takes effect everywhere.
      for (const k of Object.keys(config.providers || {})) {
        if (config.providers[k]) delete config.providers[k].voice;
      }
      writeConfig(config);
    };

    if (sub === 'preview' || sub === 'test' || sub === 'all') {
      if (!list.length) return log('No `say` voices found (this is a macOS feature).');
      log('Previewing voices — listen, then:  ai-notify voice <number>\n');
      list.forEach((n, i) => {
        log(`  ${String(i + 1).padStart(2)}. ${n}`);
        previewVoice(n, `${i + 1}番。${n}。${sample}`);
      });
      return;
    }

    if (sub === 'default' || sub === 'off' || sub === 'reset' || sub === 'none') {
      setVoice('');
      return log('Voice reset to the OS default.');
    }

    if (sub) {
      const picked = resolveVoice(sub, list);
      if (!picked) {
        console.error(`unknown voice: ${sub}   (see: ai-notify voice)`);
        process.exit(1);
      }
      setVoice(picked);
      log(`🔊 voice → ${picked}`);
      previewVoice(picked, sample);
      return;
    }

    // No arg: list the menu.
    if (!list.length) {
      log('No `say` voices found — voice selection is a macOS feature.');
      log('On other platforms, set "voice" in config.json to any name your TTS accepts.');
      return;
    }
    const current = config.voice || '(OS default)';
    log(`Current voice: ${current}\n`);
    list.forEach((n, i) => log(`  ${String(i + 1).padStart(2)}. ${n}${n === config.voice ? '   ← current' : ''}`));
    log('\n  Choose:   ai-notify voice <number|name>');
    log('  Hear all: ai-notify voice preview');
    log('  Reset:    ai-notify voice default');
  },

  // Speak in VOICEVOX character voices (local engine, free, offline).
  voicevox() {
    const sub = positionals[0] || 'status';
    const config = readConfig();
    const url = config.voicevox?.url || voicevox.DEFAULT_URL;

    if (sub === 'setup') {
      if (voicevox.isAvailable(url)) {
        log('✓ VOICEVOX engine is already running.');
        return log('Enable it:  ai-notify voicevox on    (list voices: ai-notify voicevox speakers)');
      }
      if (process.platform !== 'darwin') {
        log(`VOICEVOX is not running. Install it from ${voicevox.DOWNLOAD_URL} and launch the app, then:`);
        return log('  ai-notify voicevox on');
      }
      if (voicevox.appInstalled()) {
        log('VOICEVOX is installed but not running. Launching it…');
        voicevox.launchApp();
        log('  Waiting for the engine to start (first launch can take ~30s)…');
        if (voicevox.waitForEngine(url, 45000)) {
          log('✓ engine ready.');
          return log('Enable it:  ai-notify voicevox on');
        }
        return log('  Still starting. Once VOICEVOX is open, run:  ai-notify voicevox on');
      }
      log('VOICEVOX is not installed. Opening the download page…');
      voicevox.openDownloadPage();
      log('  1. Download the macOS app and move it to Applications.');
      log('  2. First launch is Gatekeeper-blocked (it is open-source / unsigned):');
      log('       xattr -dr com.apple.quarantine /Applications/VOICEVOX.app && open -a VOICEVOX');
      log('  3. Then run:  ai-notify voicevox setup   (or  ai-notify voicevox on)');
      return;
    }
    if (sub === 'speakers') {
      const list = voicevox.listSpeakers(url);
      if (!list.length) return log(`No speakers (is VOICEVOX running at ${url}?).`);
      list.forEach((s) => log(`  ${String(s.id).padStart(3)}  ${s.name}`));
      log(`\nUse one:  ai-notify voicevox on <id>`);
      return;
    }
    if (sub === 'on') {
      if (!voicevox.isAvailable(url)) {
        console.error(`VOICEVOX engine not reachable at ${url}. Start the VOICEVOX app first.`);
        process.exit(1);
      }
      const speaker = Number(positionals[1] || config.voicevox?.speaker || 3);
      config.tts = 'voicevox';
      config.voicevox = { ...(config.voicevox || {}), url, speaker };
      writeConfig(config);
      log(`✓ VOICEVOX on (speaker ${speaker}). Testing…`);
      voicevox.speak('ボイスボックスで読み上げます。', speaker, url);
      return;
    }
    if (sub === 'off') {
      config.tts = 'say';
      writeConfig(config);
      return log('VOICEVOX off — using the OS voice.');
    }
    if (sub === 'test') {
      const speaker = Number(positionals[1] || config.voicevox?.speaker || 3);
      const ok = voicevox.speak('これはテスト読み上げです。完了しました。', speaker, url);
      return log(ok ? `spoke with speaker ${speaker}` : `⚠ failed (is VOICEVOX running at ${url}?)`);
    }
    // status
    log(`VOICEVOX: ${config.tts === 'voicevox' ? `on (speaker ${config.voicevox?.speaker})` : 'off'}`);
    log(`  engine ${url}: ${voicevox.isAvailable(url) ? '✓ reachable' : '✗ not running'}`);
    if (config.tts !== 'voicevox') log('\nEnable:  ai-notify voicevox on    (list voices: ai-notify voicevox speakers)');
  },

  // Output volume 0.0–2.0 (1.0 = normal). Written to a state file the menu bar
  // slider also drives; $AI_NOTIFY_VOLUME overrides per window.
  volume() {
    const arg = positionals[0];
    if (arg === undefined) {
      const config = readConfig();
      const v = readVolume();
      return log(`volume: ${v != null ? v : typeof config.volume === 'number' ? config.volume : 1}`);
    }
    const n = setVolume(arg);
    log(`🔊 volume → ${n}`);
  },

  // Tsundere mode: skin the spoken read-out with a tsundere persona that turns
  // ツン (harsh + louder) on failures and デレ (warm) on clean passes. Offline,
  // deterministic, no cost.
  //   tsundere on|off|toggle | level <0-1> | test [t3|t2|t1|t0] | status
  tsundere() {
    const sub = positionals[0] || 'status';
    const config = readConfig();
    const ts = config.tsundere;
    const url = config.voicevox?.url || voicevox.DEFAULT_URL;

    const sayText = (text, voice, tone = 'normal') => {
      try {
        const t = tsundere.decorateForSay(text, tone); // human contour, not 棒読み
        execFileSync('say', voice ? ['-v', voice, t] : [t], { stdio: 'ignore' });
      } catch {
        /* non-mac / no say — ignore */
      }
    };

    if (sub === 'on' || sub === 'off' || sub === 'toggle') {
      const enabled = sub === 'toggle' ? !ts.enabled : sub === 'on';
      config.tsundere = { ...ts, enabled };
      // With VOICEVOX, resolve & cache the character's ツンツン/あまあま style ids
      // now, so fire-time skips the lookup.
      if (enabled && config.tts === 'voicevox') {
        const sm = voicevox.resolveStyles(config.voicevox?.speaker, url);
        if (sm) config.tsundere.styleMap = sm;
      }
      writeConfig(config);
      log(enabled ? '💢 ツンデレ ON（デレ⇄ツン・緊急度で口調が変化）' : 'ツンデレ OFF');
      if (enabled) {
        log('  既定の強さ:  ai-notify tsundere level <0=デレ 〜 1=ツン>');
        log('  試聴:        ai-notify tsundere test');
      }
      return;
    }
    if (sub === 'level') {
      const arg = positionals[1];
      if (arg === undefined) {
        const v = readTsundereLevel();
        return log(`tsundere level: ${v != null ? v : ts.level}  (0=デレ 〜 1=ツン)`);
      }
      const n = setTsundereLevel(arg);
      return log(`💢 tsundere level → ${n}  (0=デレ 〜 1=ツン)`);
    }
    if (sub === 'test') {
      const which = (positionals[1] || '').toLowerCase();
      const lang = ts.lang || 'ja';
      const level = readTsundereLevel() != null ? readTsundereLevel() : ts.level;
      const ja = lang === 'ja';
      const samples = {
        t3: { event: 'done', raw: 'Build failed: TypeError in auth.ts', body: ja ? 'ビルドが失敗' : 'the build failed' },
        t2: { event: 'waiting', raw: 'Claude needs your permission to run a command', body: ja ? '許可待ち' : 'waiting for your input' },
        t1: { event: 'done', raw: 'Updated three files', body: ja ? '3ファイルを更新' : 'updated three files' },
        t0: { event: 'done', raw: 'All tests passed, no issues', body: ja ? 'テスト全部パス' : 'all tests passed' },
      };
      const keys = samples[which] ? [which] : ['t3', 't2', 't1', 't0'];
      const sm = config.tts === 'voicevox' ? ts.styleMap || voicevox.resolveStyles(config.voicevox?.speaker, url) : null;
      log(`tsundere test (level ${level}, lang ${lang}):\n`);
      for (const k of keys) {
        const s = samples[k];
        const tier = tsundere.classifyUrgency(s.event, s.raw, s.body);
        const eff = tsundere.effectiveLevel(level, tier, ts.urgencyShift !== false);
        const text = tsundere.wrap(s.body, eff, tier, lang, 0);
        const mul = tsundere.volumeMul(tier, ts.volumeBoost !== false);
        const tone = tsundere.axisFor(eff);
        log(`  [${tier} ×${mul} ${tone}] ${text}`);
        if (sm) {
          const speaker = sm[tone] ?? config.voicevox?.speaker;
          voicevox.speak(text, speaker, url, mul, undefined, tsundere.effectiveProsody(tone, readVoiceProsody()));
        } else {
          sayText(text, config.voice || '', tone);
        }
      }
      return;
    }
    // status
    const lvl = readTsundereLevel() != null ? readTsundereLevel() : ts.level;
    log(`tsundere: ${ts.enabled ? '💢 ON' : 'OFF'}`);
    log(`  level:        ${lvl}  (0=デレ 〜 1=ツン)`);
    log(`  urgencyShift: ${ts.urgencyShift !== false ? 'on' : 'off'}  (緊急度で口調を増減)`);
    log(`  volumeBoost:  ${ts.volumeBoost !== false ? 'on' : 'off'}  (重大時は音量↑)`);
    log(`  lang:         ${ts.lang || 'ja'}`);
    if (!ts.enabled) log('\nEnable:  ai-notify tsundere on    試聴:  ai-notify tsundere test');
  },

  // Assign a voice to a specific pane (by tty), from the menu bar.
  //   voice-pane <tty> voicevox <id> | say <name> | clear
  'voice-pane'() {
    const [tty, kind, ref] = positionals;
    if (!tty) {
      console.error('usage: voice-pane <tty> voicevox <id> | say <name> | clear');
      process.exit(1);
    }
    if (!kind || kind === 'clear') {
      updatePaneSetting(tty, { tts: null, speaker: null, voice: null });
      return log(`pane ${tty}: voice reset to default`);
    }
    if (kind === 'voicevox') updatePaneSetting(tty, { tts: 'voicevox', speaker: Number(ref), voice: null });
    else if (kind === 'say') updatePaneSetting(tty, { tts: 'say', voice: ref, speaker: null });
    else {
      console.error(`unknown kind: ${kind}`);
      process.exit(1);
    }
    log(`pane ${tty}: ${kind} ${ref}`);
  },

  // Set a specific pane's output volume (0.0–2.0), or `clear` to follow global.
  //   volume-pane <tty> <0.0-2.0|clear>
  'volume-pane'() {
    const [tty, arg] = positionals;
    if (!tty || arg === undefined) {
      console.error('usage: volume-pane <tty> <0.0-2.0|clear>');
      process.exit(1);
    }
    if (arg === 'clear') {
      updatePaneSetting(tty, { volume: null });
      return log(`pane ${tty}: volume reset to global`);
    }
    const v = Math.min(2, Math.max(0, Number(arg)));
    updatePaneSetting(tty, { volume: v });
    log(`pane ${tty}: volume ${v}`);
  },

  // Set a specific pane's tsundere baseline level (0=デレ – 1=ツン), or `clear` to
  // follow the global level.  tsundere-pane <tty> <0-1|clear>
  'tsundere-pane'() {
    const [tty, arg] = positionals;
    if (!tty || arg === undefined) {
      console.error('usage: tsundere-pane <tty> <0-1|clear>');
      process.exit(1);
    }
    if (arg === 'clear') {
      updatePaneSetting(tty, { tsundere: null });
      return log(`pane ${tty}: tsundere level reset to global`);
    }
    const v = Math.min(1, Math.max(0, Number(arg)));
    updatePaneSetting(tty, { tsundere: v });
    log(`pane ${tty}: tsundere level ${v}`);
  },

  // Name a specific pane in the spoken read-out (set from the menu bar), or
  // `clear` to fall back to the label / speakLabel default.
  //   name-pane <tty> <name|clear>
  'name-pane'() {
    const [tty, ...rest] = positionals;
    const arg = rest.join(' ').trim(); // a name may contain spaces
    if (!tty || arg === '') {
      console.error('usage: name-pane <tty> <name|clear>');
      process.exit(1);
    }
    if (arg === 'clear') {
      updatePaneSetting(tty, { speakName: null });
      return log(`pane ${tty}: name cleared`);
    }
    updatePaneSetting(tty, { speakName: arg });
    log(`pane ${tty}: name ${arg}`);
  },

  // One-shot per-pane setup, run INSIDE the pane: set its spoken name, voice,
  // and volume — and rename the terminal tab — in a single command, instead of
  // doing each from the menu bar. Keyed by this shell's tty (which the agent's
  // hook resolves to as well), so it just works for the agent running here.
  //   use <name> [voice] [volume] [--tab <title>]   |   use clear
  // voice: a system voice name/number (Kyoko, 3), a VOICEVOX character name
  //        (ずんだもん), or vv<id> (vv3).  --tab: separate tab title (default <name>).
  use() {
    const tty = controllingTty();
    if (!tty) {
      console.error('`ai-notify use` must run inside a terminal pane (no controlling tty found).');
      process.exit(1);
    }
    // Pull --tab and its value out first, so the tab title (any token) is never
    // mistaken for the voice or volume positional.
    const rest = args.slice(1);
    let tabTitle;
    const pos = [];
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--tab') {
        if (rest[i + 1] && !rest[i + 1].startsWith('--')) tabTitle = rest[++i];
        continue;
      }
      if (!rest[i].startsWith('--')) pos.push(rest[i]);
    }
    const [name, voiceArg, volArg] = pos;
    if (!name || name === 'clear' || name === 'reset') {
      updatePaneSetting(tty, { speakName: null, tts: null, voice: null, speaker: null, volume: null });
      process.stdout.write('\u001b]0;\u0007\u001b]2;\u0007'); // clear tab title via OSC 0 + 2 (best-effort)
      return log(`✓ pane reset (${tty})`);
    }

    const patch = { speakName: name };
    let voiceLabel = '';
    if (voiceArg !== undefined) {
      const vv = /^(?:vv|voicevox):?(\d+)$/i.exec(voiceArg);
      if (vv) {
        patch.tts = 'voicevox';
        patch.speaker = Number(vv[1]);
        patch.voice = null;
        voiceLabel = `VOICEVOX ${vv[1]}`;
      } else if (resolveVoice(voiceArg, curatedVoices(10))) {
        patch.tts = 'say';
        patch.voice = resolveVoice(voiceArg, curatedVoices(10));
        patch.speaker = null;
        voiceLabel = patch.voice;
      } else {
        // A VOICEVOX character by name (e.g. ずんだもん) — resolve via the engine.
        const url = readConfig().voicevox?.url || voicevox.DEFAULT_URL;
        const chars = voicevox.isAvailable(url) ? voicevox.listCharacters(url) : [];
        const hit = chars.find((c) => c.name === voiceArg) || chars.find((c) => c.name.includes(voiceArg));
        if (!hit) {
          console.error(
            `unknown voice: ${voiceArg}\n` +
              '  say voice: a name/number from `ai-notify voice` (e.g. Kyoko, 3)\n' +
              '  VOICEVOX:  a character name (e.g. ずんだもん; engine must be running) or vv<id> (vv3)'
          );
          process.exit(1);
        }
        patch.tts = 'voicevox';
        patch.speaker = hit.id;
        patch.voice = null;
        voiceLabel = `${hit.name} (VOICEVOX ${hit.id})`;
      }
    }
    if (volArg !== undefined) {
      const v = Number(volArg);
      if (Number.isFinite(v)) patch.volume = Math.min(2, Math.max(0, v));
    }

    updatePaneSetting(tty, patch);
    // Rename this terminal tab/window (best-effort — a shell that rewrites the
    // title on each prompt may override it after you return to the prompt).
    const tab = tabTitle || name;
    process.stdout.write(`\u001b]0;${tab}\u0007\u001b]2;${tab}\u0007`);

    const bits = [`name ${name}`];
    if (voiceLabel) bits.push(`voice ${voiceLabel}`);
    if (patch.volume !== undefined) bits.push(`volume ${patch.volume}`);
    bits.push(`tab ${tab}`);
    log(`✓ ${bits.join('  ·  ')}`);
  },

  // The "waiting" character popup (menu bar app): an always-on-top window that
  // shows a character saying which pane is waiting for input. macOS-only effect.
  //   popup [on|off|toggle|image <path>|delay <sec>|ignore <kw,kw>|status]
  popup() {
    const sub = positionals[0] || 'status';
    if (sub === 'on' || sub === 'off' || sub === 'toggle') {
      const on = sub === 'toggle' ? !isPopupEnabled() : sub === 'on';
      setPopupEnabled(on);
      return log(on ? '🪧 waiting popup ON' : 'waiting popup OFF');
    }
    if (sub === 'image') {
      const p = positionals[1];
      if (!p || p === 'clear' || p === 'default') {
        setPopupImage('');
        return log('popup image cleared (using the default character).');
      }
      const abs = resolvePath(p);
      setPopupImage(abs);
      return log(`popup image → ${abs}`);
    }
    // Threshold: only pop up after a pane has been waiting this many seconds.
    if (sub === 'delay') {
      const v = parseFloat(positionals[1]);
      if (!Number.isFinite(v)) return log(`popup delay: ${getPopupDelay()}s`);
      setPopupDelay(Math.max(0, v));
      return log(v > 0 ? `popup delay → ${Math.max(0, v)}s (waits shorter than this are ignored)` : 'popup delay → 0s (immediate)');
    }
    // Suppress the popup when the waiting reason contains any of these keywords.
    if (sub === 'ignore') {
      const kw = positionals.slice(1).join(' ').trim();
      if (!kw || kw === 'clear') {
        setPopupIgnore('');
        return log('popup ignore cleared (no message filtering).');
      }
      setPopupIgnore(kw);
      return log(`popup ignore → ${kw}`);
    }
    log(`waiting popup: ${isPopupEnabled() ? '🪧 ON' : 'OFF'}`);
    log(`character image: ${getPopupImage() || '(default)'}`);
    log(`delay:          ${getPopupDelay()}s${getPopupDelay() > 0 ? ' (ignore shorter waits)' : ' (immediate)'}`);
    log(`ignore words:   ${getPopupIgnore() || '(none)'}`);
    log('\nEnable: ai-notify popup on   |   Threshold: ai-notify popup delay 15   |   Skip reasons: ai-notify popup ignore subagent,task');
  },

  // Get/set the VOICEVOX base prosody (the normal-tone scales the menu bar
  // sliders drive). With no args, prints the current values as JSON.
  //   voice-prosody [speed|pitch|intonation <value> | reset]
  'voice-prosody'() {
    const [key, val] = positionals;
    if (key === 'reset') return log(JSON.stringify(resetVoiceProsody()));
    if (!key || val === undefined) return log(JSON.stringify(readVoiceProsody()));
    const next = setVoiceProsody(key, val);
    if (!next) {
      console.error('usage: voice-prosody <speed|pitch|intonation> <value> | reset');
      process.exit(1);
    }
    log(`voice prosody ${key} → ${next[key]}`);
  },

  // Machine-readable state for the menu bar agent: mute, volume, the selectable
  // voices, and the recently-active panes (for per-pane assignment). Not human.
  'menu-json'() {
    const config = readConfig();
    const url = config.voicevox?.url || voicevox.DEFAULT_URL;
    const chars = voicevox.isAvailable(url) ? voicevox.listCharacters(url) : [];
    const idName = new Map(chars.map((c) => [c.id, c.name]));
    const voices = [];
    for (const c of chars)
      voices.push({
        section: 'VOICEVOX',
        label: c.name,
        kind: 'voicevox',
        ref: String(c.id),
        currentGlobal: config.tts === 'voicevox' && Number(config.voicevox?.speaker) === c.id,
      });
    for (const n of curatedVoices(10))
      voices.push({
        section: 'System',
        label: n,
        kind: 'say',
        ref: n,
        currentGlobal: config.tts !== 'voicevox' && config.voice === n,
      });
    const labelFor = (pv) => {
      if (!pv) return null;
      return pv.tts === 'voicevox' ? idName.get(Number(pv.speaker)) || `VOICEVOX ${pv.speaker}` : pv.voice || 'system';
    };
    // Panes = live terminals currently running an agent (so they show up before
    // they ever fire a notification) merged with previously-recorded ones.
    const globalVol = readVolume() != null ? readVolume() : typeof config.volume === 'number' ? config.volume : 1;
    const tsLevel = readTsundereLevel() != null ? readTsundereLevel() : config.tsundere?.level ?? 0.5;
    const recorded = new Map(readPanes().map((p) => [p.tty, p.label]));
    const ttys = new Set([...livePanes(), ...recorded.keys()]);
    const panes = [...ttys].map((tty) => {
      const s = readPaneSetting(tty);
      return {
        tty,
        label: recorded.get(tty) || tty.replace('/dev/', ''),
        current: labelFor(s.tts ? s : null),
        speakName: typeof s.speakName === 'string' ? s.speakName : '',
        volume: typeof s.volume === 'number' ? s.volume : globalVol,
        volumeSet: typeof s.volume === 'number',
        tsundere: typeof s.tsundere === 'number' ? s.tsundere : tsLevel,
        tsundereSet: typeof s.tsundere === 'number',
      };
    });
    log(
      JSON.stringify({
        muted: isMuted(),
        volume: readVolume() != null ? readVolume() : typeof config.volume === 'number' ? config.volume : 1,
        voices,
        panes,
        tsundere: { enabled: !!config.tsundere?.enabled, level: tsLevel },
        tts: config.tts || 'say',
        prosody: readVoiceProsody(),
        prosodyRange: VOICE_PROSODY_RANGE,
      })
    );
  },

  // Native menu bar bell (macOS). Self-contained — no Hammerspoon/SwiftBar.
  menubar() {
    const sub = positionals[0] || 'status';
    if (!menubar.isMac()) return log('The menu bar agent is macOS-only.');

    if (sub === 'install') {
      log('Installing the ai-notify menu bar agent…');
      if (!menubar.isBuilt()) log('  building the app (system Swift)…');
      const r = menubar.install();
      log(`  ✓ app:   ${r.app}`);
      log(`  ✓ agent: ${r.plist} (starts at login)`);
      log('A 🔔 is now in your menu bar. Left-click for the menu (volume, voices), right-click to mute.');
      return;
    }
    if (sub === 'uninstall') {
      menubar.uninstall();
      log('✓ Removed the menu bar agent (LaunchAgent unloaded, app stopped).');
      return;
    }
    if (sub === 'build') {
      log(`✓ built: ${menubar.build()}`);
      return;
    }
    // status
    log(`menu bar agent:`);
    log(`  built:     ${menubar.isBuilt() ? '✓' : '— (run: ai-notify menubar build)'}`);
    log(`  installed: ${menubar.isInstalled() ? '✓ (auto-start at login)' : '—'}`);
    log(`  running:   ${menubar.isRunning() ? '✓' : '—'}`);
    if (!menubar.isInstalled()) log('\nEnable it:  ai-notify menubar install');
  },

  // Translate the agent's spoken message into your language before speaking it.
  // Key-less and free (one HTTP request, no dependency); falls back to your
  // templates if offline.
  translate() {
    const sub = positionals[0] || 'status';
    const config = readConfig();

    if (sub === 'on') {
      const lang = positionals[1] || 'ja';
      config.translateTo = lang;
      config.speakAgentMessage = true; // we must keep the message to translate it
      writeConfig(config);
      log(`✓ translation on → ${lang}. Testing…`);
      const out = translate('The task is done. I updated three files.', lang, 8000);
      log(out ? `  EN→ ${out}` : '  ⚠ no result (offline?). Falls back to your templates.');
      return;
    }
    if (sub === 'off' || sub === 'none') {
      config.translateTo = '';
      writeConfig(config);
      return log('Translation off.');
    }
    if (sub === 'test') {
      const lang = config.translateTo || 'ja';
      const text = positionals.slice(1).join(' ') || 'Claude needs your permission to run a command.';
      const out = translate(text, lang, 8000);
      log(out ? `EN  ${text}\n${lang.toUpperCase()}  ${out}` : '⚠ no result (offline?)');
      return;
    }
    // status
    log(`translation: ${config.translateTo ? `on → ${config.translateTo}` : 'off'}`);
    if (!config.translateTo) log('Enable:  ai-notify translate on ja');
  },

  // Diagnose / test the waiting-window highlight. Run it INSIDE the terminal
  // tab you want to test (not piped) so it has a controlling tty.
  highlight() {
    const sub = positionals[0] || 'test';
    if (sub === 'clear') {
      clearHighlight();
      return log('cleared.');
    }
    const color = positionals[1] || readConfig().highlightColor || 'yellow';
    const info = highlightDiagnose(color);
    log(JSON.stringify(info, null, 2));
    log('\nThis tab should now be highlighted. Reset it with: ai-notify highlight clear');
    if (info.appleTerminal && String(info.appleTerminal).startsWith('ERROR')) {
      log('\n→ AppleScript was blocked. Grant permission in:');
      log('  System Settings → Privacy & Security → Automation → (your terminal) → Terminal');
    }
  },

  hook() {
    const source = opt('source', 'default');
    let event = opt('event', 'done');
    let cwd = '';
    let message = '';

    if (source === 'codex') {
      // Codex passes a single JSON argument.
      let data = {};
      try { data = JSON.parse(positionals[0] || '{}'); } catch { /* ignore */ }
      if (data.type && data.type !== 'agent-turn-complete') process.exit(0);
      cwd = data.cwd || '';
      message = data['last-assistant-message'] || '';
      event = 'done';
    } else {
      // Claude (and the generic case) pass JSON on stdin.
      const data = readStdinJson();
      cwd = data.cwd || '';
      message = data.message || '';
      // The Stop hook has no message, so "done" would only say "finished".
      // Pull the agent's last reply from the transcript so the notification
      // says WHAT was done.
      if (!message && event === 'done' && data.transcript_path) {
        message = lastAssistantText(data.transcript_path);
      }
    }

    const label = deriveLabel(cwd);
    emit({ provider: byId(source) ? source : 'default', event, label, message });
  },

  version() { log(VERSION); },
  help() { printHelp(); },
};

function emitConfirm() {
  emit({ provider: 'default', event: 'done', label: 'ai-notify', message: readConfig().onMessage });
}

function printHelp() {
  log(`ai-notify ${VERSION} — notifications for terminal AI coding agents

Usage:
  ai-notify init [--dry-run] [--only claude,codex]   wire detected agents
  ai-notify uninstall [--only ...]                   remove wiring
  ai-notify use <name> [voice] [vol] [--tab <t>]     name THIS pane + voice + tab, at once (voice: Kyoko | 3 | ずんだもん | vv3)
  ai-notify toggle | on | off | status               control the mute switch
  ai-notify volume [0.0-2.0]                          get/set output volume
  ai-notify voice [number|name|preview|default]      pick the spoken voice
  ai-notify voicevox [setup|on <id>|off|speakers|test]  speak in VOICEVOX character voices
  ai-notify tsundere [on|off|level <0-1>|test|status]   tsundere persona (ツン⇄デレ by urgency)
  ai-notify voice-prosody [speed|pitch|intonation <v>|reset]  VOICEVOX read-out tuning
  ai-notify menubar [install|uninstall|status]       native menu bar bell (macOS)
  ai-notify popup [on|off|image <p>|delay <s>|ignore <kw>]  "waiting for input" popup + when it shows (macOS)
  ai-notify translate [on <lang>|off|test]           speak agent text in your language
  ai-notify doctor                                    check deps & wiring
  ai-notify config [init]                             print (or write) config

Per-window overrides (export in a terminal before launching the agent):
  AI_NOTIFY_VOICE=Eddy    give this window/pane its own spoken voice
  AI_NOTIFY_LABEL=api     name this window in the spoken/banner read-out

Make it one tap: bind a hotkey / menubar button to \`ai-notify toggle\`
(see recipes/ for macOS Shortcuts, Raycast, Stream Deck).`);
}

const handler =
  cmds[cmd] ||
  (cmd === '-v' || cmd === '--version' ? cmds.version : null) ||
  (cmd === undefined || cmd === '-h' || cmd === '--help' ? cmds.help : null);

if (!handler) {
  console.error(`unknown command: ${cmd}\n`);
  printHelp();
  process.exit(1);
}
handler();
