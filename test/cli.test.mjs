import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));

const run = (args, { input, env } = {}) => {
  const sandbox = mkdtempSync(join(tmpdir(), 'ai-notify-'));
  return {
    sandbox,
    ...spawnSync(process.execPath, [CLI, ...args], {
      input,
      encoding: 'utf8',
      env: {
        ...process.env,
        XDG_STATE_HOME: join(sandbox, 'state'),
        XDG_CONFIG_HOME: join(sandbox, 'config'),
        ...env,
      },
    }),
  };
};

test('version', () => {
  const r = run(['--version']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /\d+\.\d+\.\d+/);
});

test('off creates the mute flag, on removes it', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'ai-notify-'));
  const env = {
    ...process.env,
    XDG_STATE_HOME: join(sandbox, 'state'),
    XDG_CONFIG_HOME: join(sandbox, 'config'),
  };
  const flag = join(sandbox, 'state', 'ai-notify', 'muted');

  spawnSync(process.execPath, [CLI, 'off'], { env, encoding: 'utf8' });
  assert.ok(existsSync(flag), 'flag should exist after off');

  spawnSync(process.execPath, [CLI, 'on'], { env, encoding: 'utf8' });
  assert.ok(!existsSync(flag), 'flag should be gone after on');
});

test('status reflects muted state', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'ai-notify-'));
  const env = {
    ...process.env,
    XDG_STATE_HOME: join(sandbox, 'state'),
    XDG_CONFIG_HOME: join(sandbox, 'config'),
  };
  spawnSync(process.execPath, [CLI, 'off'], { env, encoding: 'utf8' });
  const r = spawnSync(process.execPath, [CLI, 'status'], { env, encoding: 'utf8' });
  assert.match(r.stdout, /OFF/);
});

test('codex hook ignores non-target events and exits 0', () => {
  const r = run(['hook', '--source', 'codex', JSON.stringify({ type: 'session-start' })]);
  assert.equal(r.status, 0);
});

// Screenshot safeguard: menu-json in DEMO mode must emit ONLY the synthetic
// fixture — never the user's real panes (whose cwd-derived labels would leak
// private project / branch names into committed README assets).
test('AI_NOTIFY_DEMO menu-json emits synthetic panes only', () => {
  const r = run(['menu-json'], { env: { ...process.env, AI_NOTIFY_DEMO: '1' } });
  assert.equal(r.status, 0);
  const j = JSON.parse(r.stdout);
  const labels = j.panes.map((p) => p.label).sort();
  assert.deepEqual(labels, ['api', 'docs', 'frontend', 'release']);
  // fixed demo values, independent of any real state
  assert.equal(j.tsundere.level, 0.85);
  assert.equal(j.tts, 'voicevox');
  // none of the synthetic ttys resemble a real /dev path beyond the fixture
  assert.ok(j.panes.every((p) => /^\/dev\/ttys01[0-9]$/.test(p.tty)));
});

test('init --dry-run writes nothing and exits 0', () => {
  const r = run(['init', '--dry-run']);
  assert.equal(r.status, 0);
});

test('unknown command exits non-zero', () => {
  const r = run(['definitely-not-a-command']);
  assert.notEqual(r.status, 0);
});

// Mute must be FULLY silent: no audio AND no desktop banner (macOS plays its own
// notification ping for any banner we post, so a banner-while-muted leaks sound).
// Shadow every external audio/banner binary with a logging stub and run the real
// hook; while muted the log must stay empty.
const runHookWithStubs = ({ muted }) => {
  const sandbox = mkdtempSync(join(tmpdir(), 'ai-notify-'));
  const stateDir = join(sandbox, 'state', 'ai-notify');
  mkdirSync(stateDir, { recursive: true });
  if (muted) writeFileSync(join(stateDir, 'muted'), '');

  const binDir = join(sandbox, 'bin');
  mkdirSync(binDir, { recursive: true });
  const log = join(sandbox, 'calls.log');
  for (const b of ['afplay', 'say', 'osascript', 'terminal-notifier', 'aplay', 'paplay', 'notify-send']) {
    const f = join(binDir, b);
    writeFileSync(f, `#!/bin/sh\necho "${b} $*" >> "${log}"\n`);
    chmodSync(f, 0o755);
  }

  const transcript = join(sandbox, 'transcript.jsonl');
  writeFileSync(
    transcript,
    [
      JSON.stringify({ type: 'user', message: { content: 'do the thing' } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'did the thing' }] } }),
    ].join('\n')
  );

  spawnSync(process.execPath, [CLI, 'hook', '--event', 'done', '--source', 'claude'], {
    input: JSON.stringify({ transcript_path: transcript, cwd: sandbox }),
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      XDG_STATE_HOME: join(sandbox, 'state'),
      XDG_CONFIG_HOME: join(sandbox, 'config'),
    },
  });
  return existsSync(log) ? readFileSync(log, 'utf8').trim() : '';
};

test('muted hook makes NO sound and posts NO banner', () => {
  const calls = runHookWithStubs({ muted: true });
  assert.equal(calls, '', `muted hook should be fully silent, but ran: ${calls}`);
});

test('un-muted hook does notify (sound and/or banner)', { skip: process.platform !== 'darwin' }, () => {
  const calls = runHookWithStubs({ muted: false });
  assert.notEqual(calls, '', 'un-muted hook should produce a notification');
});
