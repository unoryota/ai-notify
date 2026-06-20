// Provider: Codex CLI (OpenAI).
//
// Codex calls a `notify` program with a single JSON argument (event
// `agent-turn-complete`). We set the root `notify` key in ~/.codex/config.toml.
//
// TOML constraint: root keys must appear before any [table]. We insert our line
// just before the first table. We never clobber a user's pre-existing notify
// program — if one exists that isn't ours, we warn and skip.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { MARKER } from '../util.mjs';

const configPath = () => join(homedir(), '.codex', 'config.toml');

export const id = 'codex';
export const displayName = 'Codex CLI';

export const detect = () => existsSync(join(homedir(), '.codex'));

const read = () => {
  try {
    return readFileSync(configPath(), 'utf8');
  } catch {
    return '';
  }
};

const ourLine = (node, cliPath) =>
  `notify = ["${node}", "${cliPath}", "hook", "--source", "codex"]`;

const COMMENT = '# ai-notify: desktop/sound notification on agent-turn-complete';

const findNotify = (text) => text.match(/^notify\s*=.*$/m);

export const status = () => {
  if (!detect()) return { installed: false, wired: false };
  const m = findNotify(read());
  return { installed: true, wired: !!(m && m[0].includes(MARKER)) };
};

export const wire = ({ node, cliPath, dryRun }) => {
  let text = read();
  const existing = findNotify(text);

  if (existing && !existing[0].includes(MARKER)) {
    return {
      changed: false,
      skipped: true,
      detail: 'a custom `notify` already exists in config.toml — not overwriting it',
      file: configPath(),
    };
  }

  const line = ourLine(node, cliPath);

  if (existing) {
    if (existing[0] === line) return { changed: false, detail: 'already wired', file: configPath() };
    text = text.replace(/^notify\s*=.*$/m, line);
  } else {
    const block = `${COMMENT}\n${line}\n`;
    const tableIdx = text.search(/^\s*\[/m); // first [table]
    if (tableIdx === -1) {
      text = (text ? text.replace(/\n*$/, '\n') : '') + block;
    } else {
      text = text.slice(0, tableIdx) + block + '\n' + text.slice(tableIdx);
    }
  }

  if (!dryRun) writeFileSync(configPath(), text);
  return { changed: true, detail: 'set `notify`', file: configPath() };
};

export const unwire = ({ dryRun } = {}) => {
  let text = read();
  const existing = findNotify(text);
  if (!existing || !existing[0].includes(MARKER)) {
    return { changed: false, detail: 'nothing to remove', file: configPath() };
  }
  text = text
    .replace(new RegExp(`^${COMMENT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`, 'm'), '')
    .replace(/^notify\s*=.*\n?/m, '');
  if (!dryRun) writeFileSync(configPath(), text);
  return { changed: true, detail: 'removed `notify`', file: configPath() };
};
