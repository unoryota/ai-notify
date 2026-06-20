// Provider: Claude Code (Anthropic).
//
// Wires two hooks in ~/.claude/settings.json:
//   - Notification -> "waiting" (Claude is asking for input/permission)
//   - Stop         -> "done"    (Claude finished its turn)
// Existing hooks are preserved; we only add/remove our own entries.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { MARKER } from '../util.mjs';

const settingsPath = () => join(homedir(), '.claude', 'settings.json');

export const id = 'claude';
export const displayName = 'Claude Code';

export const detect = () => existsSync(join(homedir(), '.claude'));

const load = () => {
  try {
    return JSON.parse(readFileSync(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
};

const save = (data) => {
  const dir = join(homedir(), '.claude');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(settingsPath(), JSON.stringify(data, null, 2) + '\n');
};

const isOurs = (cmd) => typeof cmd === 'string' && cmd.includes(MARKER) && cmd.includes(' hook ');

const entry = (node, cliPath, event) => ({
  matcher: '',
  hooks: [
    {
      type: 'command',
      command: `${node} ${cliPath} hook --source claude --event ${event}`,
      async: true,
    },
  ],
});

const EVENTS = { Notification: 'waiting', Stop: 'done' };

export const status = () => {
  if (!detect()) return { installed: false, wired: false };
  const data = load();
  const hooks = data.hooks || {};
  const wired = Object.keys(EVENTS).every((k) =>
    (hooks[k] || []).some((g) => (g.hooks || []).some((h) => isOurs(h.command)))
  );
  return { installed: true, wired };
};

export const wire = ({ node, cliPath, dryRun }) => {
  const data = load();
  data.hooks = data.hooks || {};
  const changes = [];
  for (const [event, kind] of Object.entries(EVENTS)) {
    data.hooks[event] = data.hooks[event] || [];
    const already = data.hooks[event].some((g) => (g.hooks || []).some((h) => isOurs(h.command)));
    if (!already) {
      if (!dryRun) data.hooks[event].push(entry(node, cliPath, kind));
      changes.push(`${event} -> ${kind}`);
    }
  }
  if (!dryRun && changes.length) save(data);
  return { changed: changes.length > 0, detail: changes.length ? changes.join(', ') : 'already wired', file: settingsPath() };
};

export const unwire = ({ dryRun } = {}) => {
  const data = load();
  if (!data.hooks) return { changed: false, detail: 'nothing to remove' };
  let removed = 0;
  for (const event of Object.keys(EVENTS)) {
    const groups = data.hooks[event];
    if (!Array.isArray(groups)) continue;
    for (const g of groups) {
      const before = (g.hooks || []).length;
      g.hooks = (g.hooks || []).filter((h) => !isOurs(h.command));
      removed += before - g.hooks.length;
    }
    data.hooks[event] = groups.filter((g) => (g.hooks || []).length > 0);
    if (data.hooks[event].length === 0) delete data.hooks[event];
  }
  if (!dryRun && removed) save(data);
  return { changed: removed > 0, detail: removed ? `removed ${removed} hook(s)` : 'nothing to remove', file: settingsPath() };
};
