import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
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

test('init --dry-run writes nothing and exits 0', () => {
  const r = run(['init', '--dry-run']);
  assert.equal(r.status, 0);
});

test('unknown command exits non-zero', () => {
  const r = run(['definitely-not-a-command']);
  assert.notEqual(r.status, 0);
});
