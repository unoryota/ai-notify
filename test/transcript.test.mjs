import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeTranscript } from '../src/transcript.mjs';

// JSONL line helpers mirroring the Claude Code transcript shape.
const human = (text) => JSON.stringify({ type: 'user', message: { content: text } });
const toolResult = () => JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } });
const assistantText = (text) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const assistantTool = () => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: {} }] } });

test('summarize: returns the current turn assistant text', () => {
  const t = [human('do X'), assistantText('I did X')].join('\n');
  assert.equal(summarizeTranscript(t), 'I did X');
});

test('summarize: ignores tool_use/tool_result, finds the text in this turn', () => {
  const t = [human('do X'), assistantText('working on X'), assistantTool(), toolResult(), assistantTool(), toolResult()].join('\n');
  assert.equal(summarizeTranscript(t), 'working on X');
});

test('summarize: never leaks the PREVIOUS turn summary when this turn has no text yet', () => {
  // Previous turn produced "OLD SUMMARY"; the current turn (after the human msg)
  // has only tool calls so far — the final text line hasn't flushed. Must NOT
  // return the previous turn's text.
  const t = [
    human('first task'),
    assistantText('OLD SUMMARY'),
    human('second task'),
    assistantTool(),
    toolResult(),
    assistantTool(),
    toolResult(),
  ].join('\n');
  assert.equal(summarizeTranscript(t), '');
});

test('summarize: tool_result user entries do NOT count as a turn boundary', () => {
  // The scan must skip tool_result "user" lines and still reach this turn's text.
  const t = [human('task'), assistantText('the answer'), assistantTool(), toolResult()].join('\n');
  assert.equal(summarizeTranscript(t), 'the answer');
});

test('summarize: picks the LAST text of the current turn, not an earlier one', () => {
  const t = [human('task'), assistantText('first thought'), assistantTool(), toolResult(), assistantText('final answer')].join('\n');
  assert.equal(summarizeTranscript(t), 'final answer');
});

test('summarize: truncates long summaries to ~140 chars', () => {
  const long = 'あ'.repeat(300);
  const out = summarizeTranscript([human('x'), assistantText(long)].join('\n'));
  assert.ok(out.endsWith('…'));
  assert.ok(out.length <= 141);
});

test('summarize: empty / unparseable input returns empty string', () => {
  assert.equal(summarizeTranscript(''), '');
  assert.equal(summarizeTranscript('not json\n{bad'), '');
});
