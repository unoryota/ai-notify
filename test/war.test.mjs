import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOff, modeOf, styleFor, volumeMul, effectiveProsody, wrap } from '../src/war.mjs';
import { effectiveProsody as toneProsody } from '../src/tsundere.mjs';

// 心理的安全性 is a BIPOLAR slider: center 0.5 = OFF, left = スパルタ/軍隊, right = ホワイト企業.

test('modeOf: center = off, left = spartan, right = white', () => {
  assert.equal(modeOf(0.5).mode, 'off');
  assert.ok(isOff(0.5));
  assert.ok(isOff(0.47));
  assert.equal(modeOf(0.0).mode, 'spartan');
  assert.equal(modeOf(0.2).mode, 'spartan');
  assert.equal(modeOf(1.0).mode, 'white');
  assert.equal(modeOf(0.8).mode, 'white');
  // intensity grows toward each end
  assert.ok(modeOf(0.0).intensity > modeOf(0.3).intensity);
  assert.ok(modeOf(1.0).intensity > modeOf(0.7).intensity);
});

test('styleFor: spartan→ツン, white→デレ, center→normal', () => {
  assert.equal(styleFor(0.0), 'tsun');
  assert.equal(styleFor(1.0), 'dere');
  assert.equal(styleFor(0.5), 'normal');
});

test('volume: spartan louder than off, white softer', () => {
  assert.ok(volumeMul(0.0, 'T1') > volumeMul(0.5, 'T1')); // spartan louder
  assert.ok(volumeMul(1.0, 'T1') < volumeMul(0.5, 'T1')); // white softer
});

test('prosody stays intelligible (no 早口) at both extremes', () => {
  const base = { speed: 1, pitch: 0, intonation: 1 };
  // emit stacks 心理的安全性 on top of the tone prosody
  const spartan = effectiveProsody(0.0, toneProsody('tsun', base));
  const white = effectiveProsody(1.0, toneProsody('dere', base));
  assert.ok(spartan.speed <= 1.2, `spartan too fast: ${spartan.speed}`);
  assert.ok(white.speed <= 1.0, `white should not speed up: ${white.speed}`);
});

test('wrap: off (center) returns the body unchanged', () => {
  assert.equal(wrap('テスト全部パス', 0.5, 'T0', 'ja', 0), 'テスト全部パス');
});

test('wrap: far-left is spartan/harsh, far-right is white/gentle', () => {
  const spartan = wrap('ビルドが失敗', 0.0, 'T3', 'ja', 0);
  const white = wrap('テスト全部パス', 1.0, 'T0', 'ja', 0);
  assert.match(spartan, /ビルドが失敗/);
  assert.match(white, /テスト全部パス/);
  assert.match(spartan, /！/); // barking
  assert.match(white, /(素晴らし|誇り|お祝い|大成功)/); // warm praise
  assert.notEqual(spartan, white);
});

test('wrap: rotation varies the phrase', () => {
  const a = wrap('x', 0.0, 'T3', 'ja', 0);
  const b = wrap('x', 0.0, 'T3', 'ja', 1);
  assert.notEqual(a, b);
});

test('wrap: unsupported language returns the body unchanged', () => {
  assert.equal(wrap('done', 0.0, 'T3', 'fr', 0), 'done');
});
