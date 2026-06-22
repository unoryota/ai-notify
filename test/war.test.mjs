import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOff, modeOf, styleFor, volumeMul, effectiveProsody, wrap } from '../src/war.mjs';
import { effectiveProsody as toneProsody } from '../src/tsundere.mjs';

// 心理的安全性 is a BIPOLAR slider: center 0.5 = OFF, left = ブラック企業, right = ホワイト企業.

test('modeOf: center = off, left = black, right = white', () => {
  assert.equal(modeOf(0.5).mode, 'off');
  assert.ok(isOff(0.5));
  assert.ok(isOff(0.47));
  assert.equal(modeOf(0.0).mode, 'black');
  assert.equal(modeOf(0.2).mode, 'black');
  assert.equal(modeOf(1.0).mode, 'white');
  assert.equal(modeOf(0.8).mode, 'white');
  // intensity grows toward each end
  assert.ok(modeOf(0.0).intensity > modeOf(0.3).intensity);
  assert.ok(modeOf(1.0).intensity > modeOf(0.7).intensity);
});

test('styleFor: black→ツン, white→デレ, center→normal', () => {
  assert.equal(styleFor(0.0), 'tsun');
  assert.equal(styleFor(1.0), 'dere');
  assert.equal(styleFor(0.5), 'normal');
});

test('volume: black louder than off, white softer', () => {
  assert.ok(volumeMul(0.0, 'T1') > volumeMul(0.5, 'T1')); // black louder
  assert.ok(volumeMul(1.0, 'T1') < volumeMul(0.5, 'T1')); // white softer
});

test('prosody stays intelligible (no 早口) at both extremes', () => {
  const base = { speed: 1, pitch: 0, intonation: 1 };
  // emit stacks 心理的安全性 on top of the tone prosody
  const black = effectiveProsody(0.0, toneProsody('tsun', base));
  const white = effectiveProsody(1.0, toneProsody('dere', base));
  assert.ok(black.speed <= 1.2, `black too fast: ${black.speed}`);
  assert.ok(white.speed <= 1.0, `white should not speed up: ${white.speed}`);
});

test('wrap: off (center) returns the body unchanged', () => {
  assert.equal(wrap('テスト全部パス', 0.5, 'T0', 'ja', 0), 'テスト全部パス');
});

test('wrap: far-left is black/harsh, far-right is white/gentle', () => {
  const black = wrap('ビルドが失敗', 0.0, 'T3', 'ja', 0);
  const white = wrap('テスト全部パス', 1.0, 'T0', 'ja', 0);
  assert.match(black, /ビルドが失敗/);
  assert.match(white, /テスト全部パス/);
  assert.match(black, /(直して|帰れる|対応|残業)/); // black-company pressure
  assert.match(white, /(素晴らし|誇り|お祝い|大成功)/); // warm praise
  assert.notEqual(black, white);
});

test('wrap: side × tone COMBINATION — ブラック×デレ ≠ ブラック×ツン', () => {
  const blackDere = wrap('ビルドが失敗', 0.0, 'T3', 'ja', 0, 'dere');
  const blackTsun = wrap('ビルドが失敗', 0.0, 'T3', 'ja', 0, 'tsun');
  const blackNormal = wrap('ビルドが失敗', 0.0, 'T3', 'ja', 0, 'normal');
  assert.notEqual(blackDere, blackTsun);
  assert.notEqual(blackDere, blackNormal);
  // ブラック×デレ: caring-but-pushed (sweet wording despite the black-company push)
  assert.match(blackDere, /(ごめん|一緒|頑張ろ|無理させ)/);
  // ブラック×ツン: cold/curt
  assert.match(blackTsun, /(言い訳|詰め|残業)/);
});

test('wrap: ホワイト×デレ is the most wholesome combo', () => {
  const whiteDere = wrap('テスト全部パス', 1.0, 'T0', 'ja', 0, 'dere');
  assert.match(whiteDere, /(最高|大好き|誇らし|すごい)/);
});

test('wrap: tone defaults to normal when omitted', () => {
  assert.equal(wrap('x', 0.0, 'T3', 'ja', 0), wrap('x', 0.0, 'T3', 'ja', 0, 'normal'));
});

test('wrap: rotation varies the phrase', () => {
  const a = wrap('x', 0.0, 'T3', 'ja', 0);
  const b = wrap('x', 0.0, 'T3', 'ja', 1);
  assert.notEqual(a, b);
});

test('wrap: unsupported language returns the body unchanged', () => {
  assert.equal(wrap('done', 0.0, 'T3', 'fr', 0), 'done');
});
