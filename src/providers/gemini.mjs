// Provider: Gemini CLI (Google).
//
// Wires two hooks in ~/.gemini/settings.json (same JSON `hooks` shape as Claude
// Code, just different event names — Gemini delivers the payload as JSON on
// stdin too):
//   - AfterAgent   -> "done"    (fires once per turn after the final response)
//   - Notification -> "waiting" (a system alert, e.g. a tool-permission prompt)
// Existing hooks are preserved; we only add/remove our own entries.
//
// Marked experimental because AfterAgent can fire on intermediate responses in
// some multi-step turns (google-gemini/gemini-cli#14596) — "done" is therefore
// best-effort, not a guaranteed single turn-complete signal.
//
// Adding any other agent (aider, opencode, amp, ...) follows the same recipe:
// drop a file in src/providers/ exporting this interface and register it in
// src/providers/index.mjs.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { MARKER } from '../util.mjs';

const settingsPath = () => join(homedir(), '.gemini', 'settings.json');

export const id = 'gemini';
export const displayName = 'Gemini CLI';
export const experimental = true;

export const detect = () => existsSync(join(homedir(), '.gemini'));

const load = () => {
  try {
    return JSON.parse(readFileSync(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
};

const save = (data) => {
  const dir = join(homedir(), '.gemini');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(settingsPath(), JSON.stringify(data, null, 2) + '\n');
};

const isOurs = (cmd) => typeof cmd === 'string' && cmd.includes(MARKER) && cmd.includes(' hook ');

const entry = (node, cliPath, kind) => ({
  matcher: '',
  hooks: [
    {
      type: 'command',
      command: `${node} ${cliPath} hook --source gemini --event ${kind}`,
    },
  ],
});

const EVENTS = { AfterAgent: 'done', Notification: 'waiting' };
const CORE_EVENTS = ['AfterAgent', 'Notification'];

export const status = () => {
  if (!detect()) return { installed: false, wired: false };
  const data = load();
  const hooks = data.hooks || {};
  const wired = CORE_EVENTS.every((k) =>
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
  return {
    changed: changes.length > 0,
    detail: changes.length ? changes.join(', ') : 'already wired',
    file: settingsPath(),
  };
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
  return {
    changed: removed > 0,
    detail: removed ? `removed ${removed} hook(s)` : 'nothing to remove',
    file: settingsPath(),
  };
};
