import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCommand, parseOptions } from '../src/route.mjs';

// A typical multi-pane state: one named + waiting, one named + idle, plus two
// unnamed waiting panes (so "no name" stays ambiguous).
const panes = () => [
  { tty: '/dev/ttys003', name: 'ずんだもんアルファ', waiting: true, msg: 'Claude needs your permission to run a command' },
  { tty: '/dev/ttys004', name: 'エックスサブスクライン', waiting: false, msg: '' },
];

test('option: "<name>、Aを実行" selects numbered choice 1 by key, no Enter', () => {
  const d = resolveCommand('ずんだもんアルファ、Aを実行', panes());
  assert.equal(d.ok, true);
  assert.equal(d.name, 'ずんだもんアルファ');
  assert.equal(d.action, 'option');
  assert.equal(d.text, '1'); // A -> 1
  assert.deepEqual(d.keys, []); // a TUI menu acts on the number key itself
});

test('option: spaces instead of a comma still parse', () => {
  const d = resolveCommand('ずんだもんアルファ Bを実行', panes());
  assert.equal(d.action, 'option');
  assert.equal(d.text, '2'); // B -> 2
});

test('option: Japanese "2番" reading maps to choice 2', () => {
  const d = resolveCommand('ずんだもんアルファ、2番', panes());
  assert.equal(d.action, 'option');
  assert.equal(d.text, '2');
});

test('shortcut: "はい" approves with Enter (default-highlighted choice)', () => {
  const d = resolveCommand('ずんだもんアルファ、はい', panes());
  assert.equal(d.action, 'shortcut');
  assert.equal(d.text, '');
  assert.deepEqual(d.keys, ['Enter']);
});

test('shortcut: "却下" / "いいえ" cancels with Escape', () => {
  assert.deepEqual(resolveCommand('ずんだもんアルファ、却下', panes()).keys, ['Escape']);
  assert.deepEqual(resolveCommand('ずんだもんアルファ、いいえ', panes()).keys, ['Escape']);
});

test('freeform: dictation is typed verbatim and submitted with Enter', () => {
  const d = resolveCommand('ずんだもんアルファ、テストを実行して', panes());
  assert.equal(d.action, 'freeform');
  assert.equal(d.text, 'テストを実行して');
  assert.deepEqual(d.keys, ['Enter']);
});

test('freeform: spaces and case in a multi-word command are preserved', () => {
  // norm() drops spaces for matching, but the typed body must keep them, or
  // "echo hello world" would become "echohelloworld".
  const d = resolveCommand('ずんだもんアルファ echo Hello World', panes());
  assert.equal(d.action, 'freeform');
  assert.equal(d.text, 'echo Hello World');
});

test('routes to a NAMED pane even when it is not currently waiting', () => {
  const d = resolveCommand('エックスサブスクライン、リファクタして', panes());
  assert.equal(d.ok, true);
  assert.equal(d.tty, '/dev/ttys004');
  assert.equal(d.action, 'freeform');
});

test('longest name wins: "ずんだもんアルファ" beats a "ずんだもん" pane', () => {
  const ps = [
    { tty: 'a', name: 'ずんだもん', waiting: true, msg: '' },
    { tty: 'b', name: 'ずんだもんアルファ', waiting: true, msg: '' },
  ];
  assert.equal(resolveCommand('ずんだもんアルファ、はい', ps).tty, 'b');
});

test('no name + a single waiting pane: use it, but at lower confidence', () => {
  const ps = [{ tty: 'solo', name: 'みどり', waiting: true, msg: '' }];
  const d = resolveCommand('テストして', ps);
  assert.equal(d.ok, true);
  assert.equal(d.tty, 'solo');
  assert.ok(d.confidence <= 0.6, `expected low confidence, got ${d.confidence}`);
});

test('no name + multiple waiting panes: ambiguous, does NOT act', () => {
  const ps = [
    { tty: 'a', name: 'alpha', waiting: true, msg: '' },
    { tty: 'b', name: 'beta', waiting: true, msg: '' },
  ];
  const d = resolveCommand('テストして', ps);
  assert.equal(d.ok, false);
  assert.equal(d.action, 'ambiguous');
});

test('empty utterance fails cleanly', () => {
  assert.equal(resolveCommand('', panes()).ok, false);
  assert.equal(resolveCommand('   ', panes()).ok, false);
});

test('panes with empty names never match a non-empty utterance', () => {
  // Guard against `''.includes('')` false positives: two unnamed, non-waiting
  // panes give no name match, no sole-pane fallback, and nothing waiting.
  const ps = [
    { tty: 'x', name: '', waiting: false, msg: '' },
    { tty: 'y', name: '', waiting: false, msg: '' },
  ];
  const d = resolveCommand('ずんだもん、はい', ps);
  assert.equal(d.ok, false);
});

test('named option selection picks up an explicit menu label', () => {
  const opts = parseOptions('A: PR作成 B: テスト実行');
  const ps = [{ tty: 't', name: 'alpha', waiting: true, msg: 'A: PR作成 B: テスト実行', options: opts }];
  const d = resolveCommand('alpha、Bを実行', ps);
  assert.equal(d.action, 'option');
  assert.match(d.label, /テスト実行/);
});

test('option with explicit keys (permission template) injects those keys, not the digit', () => {
  // A 許可 → Enter, B 拒否 → Escape — the user's headline example.
  const options = [
    { key: 'A', label: '許可', keys: ['Enter'] },
    { key: 'B', label: '拒否', keys: ['Escape'] },
  ];
  const ps = [{ tty: 't', name: 'ずんだもんアルファ', waiting: true, msg: '', options }];
  const a = resolveCommand('ずんだもんアルファ、Aを実行', ps);
  assert.equal(a.action, 'option');
  assert.equal(a.text, '');
  assert.deepEqual(a.keys, ['Enter']);
  const b = resolveCommand('ずんだもんアルファ、Bを実行', ps);
  assert.deepEqual(b.keys, ['Escape']);
});

test('parseOptions: lettered and numbered menus, lazy labels', () => {
  assert.deepEqual(parseOptions('選んでください A: PR作成 B: テスト実行'), [
    { key: 'A', label: 'PR作成' },
    { key: 'B', label: 'テスト実行' },
  ]);
  assert.deepEqual(parseOptions('1. Yes 2. No 3. Always'), [
    { key: '1', label: 'Yes' },
    { key: '2', label: 'No' },
    { key: '3', label: 'Always' },
  ]);
  assert.equal(parseOptions('just a sentence with no options'), null);
});

test('wake word + name-first: a command containing another pane name does not hijack routing', () => {
  // "本番環境ヘルスチェック" is BOTH the command and (a stale) pane name. Naming
  // comes first, so this must route to ジョン and dictate the rest.
  const ps = [
    { tty: 'a', name: '本番環境ヘルスチェック', waiting: false, msg: '' },
    { tty: 'b', name: 'ジョン', waiting: false, msg: '' },
  ];
  const d = resolveCommand('へい じょん 本番環境ヘルスチェック', ps);
  assert.equal(d.ok, true);
  assert.equal(d.tty, 'b'); // ジョン, not 本番環境ヘルスチェック
  assert.equal(d.action, 'freeform');
  assert.equal(d.text, '本番環境ヘルスチェック');
});

test('kana folding: katakana name matches a hiragana utterance and vice versa', () => {
  const ps = [{ tty: 'b', name: 'ジョン', waiting: true, msg: '' }];
  assert.equal(resolveCommand('じょん、はい', ps).tty, 'b'); // said hiragana, named katakana
  const ps2 = [{ tty: 'c', name: 'じょん', waiting: true, msg: '' }];
  assert.equal(resolveCommand('ジョン、はい', ps2).tty, 'c'); // said katakana, named hiragana
});

test('decomposed (NFD) dictation: voiced kana in the name still routes + keeps the command', () => {
  // SFSpeechRecognizer can emit a voiced kana as base + combining dakuten
  // (シ + ゛ instead of ジ). The command after the name must survive — a
  // regression here drops it and fails with empty-command.
  const ps = [{ tty: 'b', name: 'ジョン', waiting: false, msg: '' }];
  const d = resolveCommand('ヘイジョンハローと言って'.normalize('NFD'), ps);
  assert.equal(d.ok, true);
  assert.equal(d.tty, 'b');
  assert.equal(d.action, 'freeform');
  assert.equal(d.text.normalize('NFC'), 'ハローと言って');
});

test('voicing-fold: a mis-voiced name ("ポール"→"ボール") still routes', () => {
  // SFSpeechRecognizer very often mis-voices a custom name — "ポール" (Paul) is
  // heard as "ボール" (ball). norm() strips dakuten/handakuten so ポ=ボ=ホ match.
  const ps = [{ tty: 'p', name: 'ポール', waiting: false, msg: '' }];
  const d = resolveCommand('へい ボール、ステータスを出して', ps);
  assert.equal(d.ok, true);
  assert.equal(d.tty, 'p');
  assert.equal(d.action, 'freeform');
  assert.equal(d.text, 'ステータスを出して');
});

test('the particle 「に」 is not mistaken for option 2', () => {
  // "にげて" (run away) must stay free-form, not select choice 2.
  const d = resolveCommand('ずんだもんアルファ、にげて', panes());
  assert.equal(d.action, 'freeform');
  assert.equal(d.text, 'にげて');
});
