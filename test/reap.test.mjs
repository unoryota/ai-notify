import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// reapDeadPanes resolves the state dir per-call from XDG_STATE_HOME, so each
// test points it at a fresh sandbox before importing.
const sandbox = mkdtempSync(join(tmpdir(), 'ai-notify-reap-'));
process.env.XDG_STATE_HOME = join(sandbox, 'state');
const stateDir = join(sandbox, 'state', 'ai-notify');
mkdirSync(stateDir, { recursive: true });

const { reapDeadPanes } = await import('../src/state.mjs');

const panesPath = join(stateDir, 'panes.json');
const waitingPath = join(stateDir, 'waiting.json');
const paneVoicesPath = join(stateDir, 'pane-voices.json');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

const seedVoices = () =>
  writeFileSync(
    paneVoicesPath,
    JSON.stringify({
      '/dev/ttys000': { tts: 'voicevox', speaker: 3, speakName: 'live' },
      '/dev/ttys004': { tts: 'voicevox', speaker: 3, speakName: 'fugu' },
    }),
  );

const seed = () => {
  writeFileSync(
    panesPath,
    JSON.stringify({
      '/dev/ttys000': { label: 'live', ts: 2 },
      '/dev/ttys004': { label: 'ghost', ts: 1 },
    }),
  );
  writeFileSync(
    waitingPath,
    JSON.stringify({
      '/dev/ttys000': { ts: 2, msg: 'Claude is waiting for your input' },
      '/dev/ttys004': { ts: 1, msg: 'Claude is waiting for your input' },
    }),
  );
};

test('reapDeadPanes drops records whose tty is not live (panes + waiting)', () => {
  seed();
  const removed = reapDeadPanes(['/dev/ttys000']);
  assert.equal(removed, 2, 'one ghost in panes + one in waiting = 2 removed');
  assert.deepEqual(Object.keys(readJson(panesPath)), ['/dev/ttys000']);
  assert.deepEqual(Object.keys(readJson(waitingPath)), ['/dev/ttys000']);
});

test('reapDeadPanes with no live ttys clears everything (reboot case)', () => {
  seed();
  const removed = reapDeadPanes([]);
  assert.equal(removed, 4);
  assert.deepEqual(readJson(panesPath), {});
  assert.deepEqual(readJson(waitingPath), {});
});

test('reapDeadPanes keeps all live records and reports 0 removed', () => {
  seed();
  const removed = reapDeadPanes(['/dev/ttys000', '/dev/ttys004']);
  assert.equal(removed, 0);
  assert.deepEqual(Object.keys(readJson(panesPath)).sort(), ['/dev/ttys000', '/dev/ttys004']);
});

test('reapDeadPanes leaves pane-voices alone by default (per-render reap)', () => {
  seed();
  seedVoices();
  reapDeadPanes(['/dev/ttys000']);
  // the per-render reap must NOT drop voice config for an idle (not-running) pane
  assert.deepEqual(Object.keys(readJson(paneVoicesPath)).sort(), ['/dev/ttys000', '/dev/ttys004']);
});

test('reapDeadPanes with includeVoices clears dead per-pane names (startup/reboot)', () => {
  seed();
  seedVoices();
  const removed = reapDeadPanes(['/dev/ttys000'], { includeVoices: true });
  // ghost in panes + waiting + pane-voices = 3
  assert.equal(removed, 3);
  assert.deepEqual(Object.keys(readJson(paneVoicesPath)), ['/dev/ttys000']);
  // a recycled tty no longer inherits the previous session's read-out name
  assert.equal(readJson(paneVoicesPath)['/dev/ttys000'].speakName, 'live');
});

test('reapDeadPanes is a no-op when the state files do not exist', () => {
  // fresh sub-dir with no panes.json / waiting.json
  process.env.XDG_STATE_HOME = join(sandbox, 'empty');
  mkdirSync(join(sandbox, 'empty', 'ai-notify'), { recursive: true });
  const removed = reapDeadPanes(['/dev/ttys000']);
  assert.equal(removed, 0);
  assert.ok(!existsSync(join(sandbox, 'empty', 'ai-notify', 'panes.json')));
  // restore for any later tests
  process.env.XDG_STATE_HOME = join(sandbox, 'state');
});
