// Provider: Gemini CLI (Google) — contributor stub.
//
// Gemini CLI is detected here, but a stable "turn complete" hook/notify
// mechanism is not yet wired. This file is the on-ramp for contributors: see
// claude.mjs / codex.mjs for the shape, implement detect/wire/unwire, and open
// a PR. Until then `wire()` is a no-op that explains the situation.
//
// The same applies to adding any other agent (aider, opencode, amp, ...):
// drop a new file in src/providers/ exporting the same interface and register
// it in src/providers/index.mjs.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

export const id = 'gemini';
export const displayName = 'Gemini CLI';
export const experimental = true;

export const detect = () => existsSync(join(homedir(), '.gemini'));

export const status = () => ({ installed: detect(), wired: false });

export const wire = () => ({
  changed: false,
  skipped: true,
  detail: 'detected, but no supported notification hook yet — contributions welcome',
});

export const unwire = () => ({ changed: false, detail: 'nothing to remove' });
