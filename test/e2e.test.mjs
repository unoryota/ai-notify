// End-to-end coverage: drive the REAL CLI through (nearly) every command and a
// few realistic sequences, in a fully isolated sandbox — own HOME + XDG dirs, and
// every external audio/network binary shadowed by a no-op stub so nothing plays,
// dials out, or touches the real machine. Asserts exit codes + key output so a
// regression anywhere in the command surface fails the suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));

// One sandbox + stub-bin reused across the file (commands are independent).
const sandbox = mkdtempSync(join(tmpdir(), 'ai-notify-e2e-'));
const home = join(sandbox, 'home');
const bin = join(sandbox, 'bin');
mkdirSync(home, { recursive: true });
mkdirSync(bin, { recursive: true });
for (const b of ['say', 'afplay', 'osascript', 'terminal-notifier', 'curl', 'open', 'aplay', 'paplay', 'spd-say', 'espeak', 'espeak-ng', 'notify-send', 'powershell', 'pgrep', 'pkill', 'launchctl']) {
  const f = join(bin, b);
  writeFileSync(f, '#!/bin/sh\nexit 0\n'); // no output, success — voicevox/curl => "unavailable" => safe fallback
  chmodSync(f, 0o755);
}

const env = {
  ...process.env,
  HOME: home,
  PATH: `${bin}:${process.env.PATH}`,
  XDG_STATE_HOME: join(sandbox, 'state'),
  XDG_CONFIG_HOME: join(sandbox, 'config'),
};

const run = (args, input) => spawnSync(process.execPath, [CLI, ...args], { input, encoding: 'utf8', env, timeout: 20000 });
const ok = (args, input) => {
  const r = run(args, input);
  assert.equal(r.status, 0, `\`${args.join(' ')}\` exited ${r.status}\n${r.stderr || r.stdout}`);
  return r;
};

test('e2e: meta commands run', () => {
  assert.match(ok(['--version']).stdout, /\d+\.\d+\.\d+/);
  assert.match(ok(['help']).stdout, /Usage:/);
  ok(['doctor']);
  ok(['status']);
  ok(['config']);
  ok(['init', '--dry-run']);
  ok(['uninstall', '--dry-run']);
});

test('e2e: mute switch round-trips', () => {
  ok(['off']);
  assert.match(ok(['status', '--plain']).stdout, /muted/);
  ok(['on']);
  assert.match(ok(['status', '--plain']).stdout, /on/);
  assert.match(ok(['status', '--icon']).stdout, /🔔|🔕/);
});

test('e2e: volume + prosody get/set', () => {
  ok(['volume', '0.8']);
  assert.match(ok(['volume']).stdout, /0\.8/);
  ok(['voice-prosody', 'speed', '1.1']);
  ok(['voice-prosody', 'pitch', '0.05']);
  ok(['voice-prosody', 'intonation', '1.2']);
  ok(['voice-prosody', 'reset']);
});

test('e2e: voice listing + default', () => {
  ok(['voice']); // list
  ok(['voice', 'default']);
  ok(['voicevox', 'speakers']); // stubbed curl => empty, must not crash
  ok(['voicevox', 'off']);
});

test('e2e: tsundere toggle + level + test + status', () => {
  ok(['tsundere', 'on']);
  assert.match(ok(['tsundere', 'status']).stdout, /💢 ON/);
  ok(['tsundere', 'level', '0.85']);
  ok(['tsundere', 'level', '0.0']);
  ok(['tsundere', 'test']); // stubbed say/curl => no audio
  ok(['tsundere', 'test', 't0']);
  ok(['tsundere', 'toggle']);
  assert.match(ok(['tsundere', 'status']).stdout, /OFF/);
});

test('e2e: 心理的安全性 (safety) toggle + bipolar level + test, war alias', () => {
  ok(['safety', 'on']);
  assert.match(ok(['safety', 'status']).stdout, /🏢 ON/);
  ok(['safety', 'level', '0.0']); // black max
  assert.match(ok(['safety', 'status']).stdout, /ブラック/);
  ok(['safety', 'level', '1.0']); // white max
  assert.match(ok(['safety', 'status']).stdout, /ホワイト/);
  ok(['safety', 'level', '0.5']); // off (center)
  ok(['safety', 'test']); // both extremes
  ok(['war', 'status']); // alias still works
  ok(['war', 'toggle']);
});

test('e2e: notify kinds matrix + toggles', () => {
  assert.match(ok(['notify']).stdout, /done|input|permission/);
  ok(['notify', 'done', 'off']);
  ok(['notify', 'done', 'on']);
  ok(['notify', 'subagent-done', 'on']);
});

test('e2e: popup config', () => {
  ok(['popup', 'on']);
  ok(['popup', 'delay', '15']);
  ok(['popup', 'ignore', 'subagent,task']);
  assert.match(ok(['popup']).stdout, /🪧 ON/);
  ok(['popup', 'off']);
});

test('e2e: `use` (name only) handles tty/no-tty cleanly (no stack trace)', () => {
  // name-only avoids `say` voice resolution (stubbed here). With a controlling
  // tty it succeeds; headless it fails with a CLEAR message — never a stack trace.
  const r = run(['use', 'api']);
  assert.ok(r.status === 0 || r.status === 1, `unexpected exit ${r.status}: ${r.stderr}`);
  if (r.status === 1) assert.match(r.stderr, /terminal pane|controlling tty/);
  assert.doesNotMatch(`${r.stderr || ''}`, /\bat (Object|file:|async)|TypeError|ReferenceError|is not a function/);
});

test('e2e: per-pane settings (explicit tty) reflected in menu-json', () => {
  ok(['name-pane', '/dev/ttysE2E', 'Zunda']);
  ok(['voice-pane', '/dev/ttysE2E', 'say', 'Daniel']);
  ok(['volume-pane', '/dev/ttysE2E', '1.2']);
  ok(['tsundere-pane', '/dev/ttysE2E', '0.9']);
  ok(['war-pane', '/dev/ttysE2E', '0.1']);
  const j = JSON.parse(ok(['menu-json']).stdout);
  assert.ok(Array.isArray(j.panes));
  assert.equal(typeof j.tsundere.enabled, 'boolean');
  assert.equal(typeof j.war.enabled, 'boolean');
  // per-pane clears
  ok(['war-pane', '/dev/ttysE2E', 'clear']);
  ok(['tsundere-pane', '/dev/ttysE2E', 'clear']);
});

test('e2e: preset save / load / list / delete round-trip', () => {
  ok(['volume', '1.3']);
  ok(['tsundere', 'on']);
  ok(['safety', 'level', '0.2']);
  ok(['preset', 'save', 'mood']);
  assert.match(ok(['preset', 'list']).stdout, /mood/);
  ok(['volume', '0.5']);
  ok(['preset', 'load', 'mood']);
  assert.match(ok(['volume']).stdout, /1\.3/); // restored
  ok(['preset', 'delete', 'mood']);
});

test('e2e: hook (done with transcript) + waiting, fully silent paths', () => {
  const tx = join(sandbox, 'tx.jsonl');
  writeFileSync(
    tx,
    [JSON.stringify({ type: 'user', message: { content: 'go' } }), JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'done it' }] } })].join('\n')
  );
  ok(['hook', '--event', 'done', '--source', 'claude'], JSON.stringify({ transcript_path: tx, cwd: sandbox }));
  ok(['hook', '--event', 'waiting', '--source', 'claude'], JSON.stringify({ notification_type: 'idle_prompt', cwd: sandbox }));
  // codex shape
  ok(['hook', '--source', 'codex', JSON.stringify({ type: 'agent-turn-complete', 'last-assistant-message': 'ok', cwd: sandbox })]);
});

test('e2e: translate off + menubar status (read-only)', () => {
  ok(['translate', 'off']);
  ok(['menubar', 'status']);
});

test('e2e: unknown command exits non-zero', () => {
  assert.notEqual(run(['definitely-not-real']).status, 0);
});
