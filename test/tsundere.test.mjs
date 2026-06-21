import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyUrgency, effectiveLevel, volumeMul, axisFor, wrap } from '../src/tsundere.mjs';

test('classifyUrgency: failures are critical', () => {
  assert.equal(classifyUrgency('done', 'Build failed: TypeError'), 'T3');
  assert.equal(classifyUrgency('done', 'The process crashed with an exception'), 'T3');
  assert.equal(classifyUrgency('waiting', 'Claude needs permission to run rm -rf build'), 'T3');
});

test('classifyUrgency: clean passes are positive (even if they mention "error")', () => {
  assert.equal(classifyUrgency('done', 'All tests passed, no errors'), 'T0');
  assert.equal(classifyUrgency('done', 'テストは全部通過、問題なし'), 'T0');
  assert.equal(classifyUrgency('done', 'LGTM, approved'), 'T0');
});

test('classifyUrgency: plain waiting is T2, plain done is T1', () => {
  assert.equal(classifyUrgency('waiting', 'Which option do you want?'), 'T2');
  // A generic permission-to-run is a wait, not a critical destructive approval.
  assert.equal(classifyUrgency('waiting', 'Claude needs your permission to run a command'), 'T2');
  assert.equal(classifyUrgency('done', 'Updated three files'), 'T1');
});

test('effectiveLevel: urgency shifts the baseline and clamps', () => {
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
  close(effectiveLevel(0.5, 'T3'), 0.9); // toward ツン
  close(effectiveLevel(0.5, 'T0'), 0.1); // toward デレ
  close(effectiveLevel(0.5, 'T1'), 0.5); // neutral
  assert.equal(effectiveLevel(0.9, 'T3'), 1); // clamped
  close(effectiveLevel(0.5, 'T3', false), 0.5); // shift disabled
});

test('volumeMul: louder on critical, never quieter on positive', () => {
  assert.equal(volumeMul('T3'), 1.3);
  assert.equal(volumeMul('T0'), 1); // T0 does not lower volume
  assert.equal(volumeMul('T3', false), 1); // boost disabled
});

test('axisFor maps the effective level to a tone', () => {
  assert.equal(axisFor(0.9), 'tsun');
  assert.equal(axisFor(0.1), 'dere');
  assert.equal(axisFor(0.5), 'normal');
});

test('wrap: keeps the body, changes tone with the level', () => {
  const tsun = wrap('ビルドが失敗', 0.9, 'T3', 'ja', 0);
  const dere = wrap('テスト全部パス', 0.1, 'T0', 'ja', 0);
  assert.match(tsun, /ビルドが失敗/);
  assert.match(dere, /テスト全部パス/);
  assert.notEqual(tsun, dere);
});

test('wrap: rotation varies the phrase for repeated input', () => {
  const a = wrap('x', 0.9, 'T3', 'ja', 0);
  const b = wrap('x', 0.9, 'T3', 'ja', 1);
  assert.notEqual(a, b);
});

test('wrap: unsupported language returns the body unchanged', () => {
  assert.equal(wrap('done', 0.9, 'T3', 'fr', 0), 'done');
});
