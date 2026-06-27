import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { joinName, restoreAgentNames, summaryMaxChars, shortenForSpeech, effectiveSummaryLevel, looksLikeInputRequest } from '../src/notify.mjs';

// Isolate state-file reads (effectiveSummaryLevel falls through to readSummaryLevel)
// to an empty dir so the suite never depends on the developer's live 要約度 setting.
process.env.XDG_STATE_HOME = join(tmpdir(), `ai-notify-test-${process.pid}`);

test('looksLikeInputRequest: a turn that asks for input is detected, a finished one is not', () => {
  // The screenshot case: a clarification that ends its turn with A/B/C/D choices.
  const choices = [
    'どれに近いか教えてください：',
    '- A. 友だち状態バッジの話',
    '- B. コードベースのhitステータス',
    '- C. プロセスの実行ステータス',
    '- D. その他',
    'ひと言補足いただければ、すぐ調べて表示します。',
  ].join('\n');
  assert.equal(looksLikeInputRequest(choices), true); // enumerated choices
  assert.equal(looksLikeInputRequest('この方針で進めてよいですか？'), true); // 末尾の疑問
  assert.equal(looksLikeInputRequest('Should I proceed with this approach?'), true);
  assert.equal(looksLikeInputRequest('どちらの実装にしますか'), true); // interrogative ending
  // A plainly finished turn must stay "done" — no false yellow.
  assert.equal(looksLikeInputRequest('3ファイルを更新しました。テストも通っています。'), false);
  assert.equal(looksLikeInputRequest('なぜ失敗したのか調べました。原因はnullでした。'), false);
  assert.equal(looksLikeInputRequest(''), false);
});

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

test('summaryMaxChars: MIN is silent, MAX is the whole message', () => {
  assert.equal(summaryMaxChars(0), 0); // 効果音のみ・読み上げなし
  assert.equal(summaryMaxChars(-1), 0); // clamped
  assert.equal(summaryMaxChars(1), Infinity); // 全文読み上げ
  assert.equal(summaryMaxChars(2), Infinity); // clamped
});

test('summaryMaxChars: anchors hit the user-specified duration tiers', () => {
  // ≈7.5 Japanese chars/sec → these are the durations from the spec.
  assert.equal(summaryMaxChars(0.1), 12); // ~1–2秒
  assert.equal(summaryMaxChars(0.25), 38); // ~5秒
  assert.equal(summaryMaxChars(0.5), 75); // ~10秒
  assert.equal(summaryMaxChars(0.9), 150); // ~20秒
});

test('summaryMaxChars: increases monotonically between anchors', () => {
  let prev = -1;
  for (let lv = 0.01; lv < 1; lv += 0.01) {
    const m = summaryMaxChars(lv);
    assert.ok(m >= prev, `level ${lv} should not shrink the budget`);
    prev = m;
  }
});

test('shortenForSpeech: Infinity budget returns the full text', () => {
  const t = 'タスクが完了しました。3つのファイルを更新しました。テストも通っています。';
  assert.equal(shortenForSpeech(t, Infinity), t);
});

test('shortenForSpeech: packs whole sentences up to the budget, not just the first', () => {
  const t = 'aaa。bbb。ccc。ddd。';
  // Budget for ~2 sentences ("aaa。bbb。" = 8 chars) but not the third.
  const out = shortenForSpeech(t, 9);
  assert.equal(out, 'aaa。bbb。');
});

test('shortenForSpeech: a single over-budget sentence is clause-cut, never run-on', () => {
  const t = 'これは、とても、長い、ひとつの、文です';
  const out = shortenForSpeech(t, 8);
  assert.ok(out.length <= 8);
  assert.ok(!out.endsWith('、')); // trailing clause separator trimmed
});

test('effectiveSummaryLevel: env override wins and is clamped', () => {
  const prev = process.env.AI_NOTIFY_SUMMARY_LEVEL;
  process.env.AI_NOTIFY_SUMMARY_LEVEL = '0.5';
  assert.equal(effectiveSummaryLevel({}, {}), 0.5);
  process.env.AI_NOTIFY_SUMMARY_LEVEL = '9';
  assert.equal(effectiveSummaryLevel({}, {}), 1);
  if (prev === undefined) delete process.env.AI_NOTIFY_SUMMARY_LEVEL;
  else process.env.AI_NOTIFY_SUMMARY_LEVEL = prev;
});

test('effectiveSummaryLevel: per-pane beats config; legacy speakAgentMessage maps to full', () => {
  const prev = process.env.AI_NOTIFY_SUMMARY_LEVEL;
  delete process.env.AI_NOTIFY_SUMMARY_LEVEL;
  assert.equal(effectiveSummaryLevel({ speakAgentMessage: true }, { summary: 0.3 }), 0.3);
  assert.equal(effectiveSummaryLevel({ speakAgentMessage: true }, {}), 1);
  assert.equal(effectiveSummaryLevel({}, {}), 0.25); // default ~5s
  if (prev !== undefined) process.env.AI_NOTIFY_SUMMARY_LEVEL = prev;
});
