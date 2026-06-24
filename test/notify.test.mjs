import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinName, restoreAgentNames } from '../src/notify.mjs';

test('joinName: Japanese uses a vocative comma, never a double topic', () => {
  // The body already carries its own subject ("Claudeは…"); the name must NOT
  // add a second topic particle ("〇〇わ、Claudeは…") — a comma reads naturally.
  assert.equal(
    joinName('みどり', 'Claudeはあなたの入力を待っています'),
    'みどり、Claudeはあなたの入力を待っています'
  );
  assert.equal(joinName('ペイン1', '入力待ちです'), 'ペイン1、入力待ちです');
  // No 「は」/「わ」 topic particle should be inserted right after the name.
  assert.doesNotMatch(joinName('みどり', 'Claudeは待っています'), /^みどり[はわ]/);
});

test('joinName: non-Japanese bodies join with an ASCII comma', () => {
  assert.equal(joinName('John', 'is waiting for input'), 'John, is waiting for input');
});

test('joinName: no name returns the body unchanged', () => {
  assert.equal(joinName('', 'Claudeは待っています'), 'Claudeは待っています');
  assert.equal(joinName(undefined, 'finished'), 'finished');
});

test('restoreAgentNames: restores product-name casing lowercased by translation', () => {
  assert.equal(
    restoreAgentNames('claudeはあなたの入力を待っています'),
    'Claudeはあなたの入力を待っています'
  );
  assert.equal(restoreAgentNames('codex finished, gemini idle'), 'Codex finished, Gemini idle');
});

test('restoreAgentNames: leaves already-correct casing and unrelated words alone', () => {
  assert.equal(restoreAgentNames('Claude is done'), 'Claude is done');
  // Only whole words — does not mangle substrings.
  assert.equal(restoreAgentNames('claudette'), 'claudette');
});
