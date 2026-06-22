#!/usr/bin/env node
// Regenerate the README screenshots — SAFELY. Screenshots used to be taken
// ad-hoc against the developer's live menu bar, which leaked real project names,
// branch names, and pane labels into committed assets. Never again: this script
// drives the menu bar app in DEMO mode (AI_NOTIFY_DEMO=1) against a throwaway
// state dir, so every captured image contains only invented data.
//
//   node scripts/capture.mjs            # regenerate all shots
//   node scripts/capture.mjs menubar    # just one
//
// Requires macOS (uses the built menu bar app + screencapture). Grant the
// controlling terminal Screen Recording permission or the PNGs come out blank.

import { mkdtempSync, writeFileSync, mkdirSync, chmodSync, existsSync, statSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(root, 'menubar', 'dist', 'ai-notify.app', 'Contents', 'MacOS', 'ai-notify-menubar');
const CLI = join(root, 'src', 'cli.mjs');
const ASSETS = join(root, 'assets');

if (process.platform !== 'darwin') {
  console.error('capture.mjs is macOS-only (needs the menu bar app + screencapture).');
  process.exit(1);
}
if (!existsSync(APP)) {
  console.error('Menu bar app not built. Run:  yarn build:menubar  (or: ai-notify menubar build)');
  process.exit(1);
}

// A throwaway state dir so we never read or write the real ~/.local/state. The
// only thing the app needs there is the `cli` launcher it shells out to; in DEMO
// mode that CLI returns a fixed synthetic fixture (see demoMenuJson in cli.mjs).
const sandbox = mkdtempSync(join(tmpdir(), 'ai-notify-shot-'));
const stateDir = join(sandbox, 'state', 'ai-notify');
mkdirSync(stateDir, { recursive: true });
const launcher = join(stateDir, 'cli');
writeFileSync(launcher, `#!/bin/sh\nexec "${process.execPath}" "${CLI}" "$@"\n`);
chmodSync(launcher, 0o755);

const env = {
  ...process.env,
  XDG_STATE_HOME: join(sandbox, 'state'),
  XDG_CONFIG_HOME: join(sandbox, 'config'),
  AI_NOTIFY_DEMO: '1',
};

const shoot = (name, target) => {
  const out = join(ASSETS, `${name}.png`);
  const r = spawnSync(APP, ['--shot', out, '--shot-target', target], { env, encoding: 'utf8', timeout: 30000 });
  const ok = existsSync(out) && statSync(out).size > 1000;
  console.log(`${ok ? '✓' : '✗'} ${name}.png  (${target})${ok ? '' : `  — FAILED${r.stderr ? `: ${r.stderr.trim()}` : ''}`}`);
  return ok;
};

const targets = {
  menubar: () => shoot('menubar', 'menu'),
  settings: () => shoot('settings', 'settings'),
};

const which = process.argv[2];
const run = which ? { [which]: targets[which] } : targets;
if (which && !targets[which]) {
  console.error(`unknown target: ${which}. Known: ${Object.keys(targets).join(', ')}`);
  process.exit(1);
}

let allOk = true;
for (const fn of Object.values(run)) allOk = fn() && allOk;

// Best-effort cleanup of the throwaway dir.
try {
  execFileSync('rm', ['-rf', sandbox]);
} catch {
  /* leave it for the OS tmp reaper */
}

process.exit(allOk ? 0 : 1);
