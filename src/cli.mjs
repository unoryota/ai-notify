#!/usr/bin/env node
// ai-notify — desktop/sound notifications for terminal AI coding agents.
// One mute switch for all of them, across every terminal. No daemon.

import { readFileSync } from 'node:fs';
import { providers, byId } from './providers/index.mjs';
import { emit } from './notify.mjs';
import { deriveLabel, cliInvocation, isEphemeralInstall } from './util.mjs';
import { isMuted, setMuted, toggleMuted, readConfig, writeConfig, paths, DEFAULT_CONFIG } from './state.mjs';

const VERSION = '0.1.0';

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
    if (!dryRun) log('Restart already-running Codex sessions to pick up the change.');
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
    }

    const label = deriveLabel(cwd);
    emit({ provider: byId(source) ? source : 'default', event, label, message });
  },

  version() { log(VERSION); },
  help() { printHelp(); },
};

function emitConfirm() {
  emit({ provider: 'default', event: 'done', label: 'ai-notify', message: 'notifications on' });
}

function printHelp() {
  log(`ai-notify ${VERSION} — notifications for terminal AI coding agents

Usage:
  ai-notify init [--dry-run] [--only claude,codex]   wire detected agents
  ai-notify uninstall [--only ...]                   remove wiring
  ai-notify toggle | on | off | status               control the mute switch
  ai-notify doctor                                    check deps & wiring
  ai-notify config [init]                             print (or write) config

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
