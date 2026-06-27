import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inferAliases } from '../src/aliases.mjs';

test('inferAliases: an English name infers its katakana + hiragana', () => {
  assert.deepEqual(inferAliases('Paul'), ['ポール', 'ぽーる']);
  assert.deepEqual(inferAliases('John'), ['ジョン', 'じょん']);
  assert.deepEqual(inferAliases('Mike'), ['マイク', 'まいく']);
});

test('inferAliases: a katakana name infers hiragana + the English spelling', () => {
  assert.deepEqual(inferAliases('ポール'), ['ぽーる', 'Paul']);
  assert.deepEqual(inferAliases('ジョン'), ['じょん', 'John']);
});

test('inferAliases: a hiragana name infers katakana + English', () => {
  assert.deepEqual(inferAliases('ぽーる'), ['ポール', 'Paul']);
});

test('inferAliases: a non-dictionary kana name just folds the kana', () => {
  // No English mapping → only the katakana⇄hiragana fold, never the primary.
  assert.deepEqual(inferAliases('ずんだもんアルファ'), ['ずんだもんあるふぁ', 'ズンダモンアルファ']);
});

test('inferAliases: an unknown latin label infers nothing (no junk aliases)', () => {
  assert.deepEqual(inferAliases('api'), []);
  assert.deepEqual(inferAliases('web'), []);
  assert.deepEqual(inferAliases(''), []);
});

test('inferAliases: never includes the primary name itself', () => {
  for (const n of ['Paul', 'ポール', 'ぽーる', 'John']) {
    assert.ok(!inferAliases(n).includes(n), `${n} should not alias itself`);
  }
});
