import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePanes } from '../src/tmux.mjs';

test('parsePanes: maps each pane tty -> { paneId, title }', () => {
  const out = [
    '/dev/ttys003\t%5\tmain:0.0',
    '/dev/ttys004\t%6\tmain:0.1',
    '/dev/ttys007\t%9\twork:1.0',
  ].join('\n');
  assert.deepEqual(parsePanes(out), {
    '/dev/ttys003': { paneId: '%5', title: 'main:0.0' },
    '/dev/ttys004': { paneId: '%6', title: 'main:0.1' },
    '/dev/ttys007': { paneId: '%9', title: 'work:1.0' },
  });
});

test('parsePanes: empty / null input -> empty map', () => {
  assert.deepEqual(parsePanes(''), {});
  assert.deepEqual(parsePanes(null), {});
  assert.deepEqual(parsePanes(undefined), {});
});

test('parsePanes: skips malformed lines (missing pane id)', () => {
  const out = ['/dev/ttys003\t%5\tmain:0.0', 'garbage-without-tabs', '\t%7\t'].join('\n');
  assert.deepEqual(parsePanes(out), { '/dev/ttys003': { paneId: '%5', title: 'main:0.0' } });
});

test('parsePanes: a pane id with no title falls back to the id', () => {
  assert.deepEqual(parsePanes('/dev/ttys003\t%5\t'), { '/dev/ttys003': { paneId: '%5', title: '%5' } });
});
