// Small shared helpers (no third-party deps).

import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// A human label for the terminal/tab, in priority order:
//   1. $AI_NOTIFY_LABEL  (set it per tab to name your work)
//   2. git branch of the working dir
//   3. the directory name
export const deriveLabel = (cwd) => {
  if (process.env.AI_NOTIFY_LABEL) return process.env.AI_NOTIFY_LABEL;
  if (cwd) {
    try {
      const branch = execFileSync('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], {
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .toString()
        .trim();
      if (branch && branch !== 'HEAD') return `${basename(cwd)}/${branch}`;
    } catch {
      /* not a git repo */
    }
    return basename(cwd);
  }
  return 'somewhere';
};

// Absolute path to this package's CLI, and the node that should run it.
// These get embedded into each agent's hook config so the hooks work
// regardless of the shell's PATH at fire time.
export const cliInvocation = () => ({
  node: process.execPath,
  cliPath: fileURLToPath(new URL('./cli.mjs', import.meta.url)),
});

// Hooks need a persistent install. `npx` runs from an ephemeral cache that can
// be garbage-collected, which would break the wiring later.
export const isEphemeralInstall = (cliPath) => /[/\\]_npx[/\\]/.test(cliPath);

export const MARKER = 'ai-notify'; // substring used to detect our own wiring

// The controlling terminal of this process (e.g. "/dev/ttys010"), which is
// stable per terminal pane — used to scope per-pane settings. null if none.
export const controllingTty = () => {
  try {
    const t = execFileSync('ps', ['-o', 'tty=', '-p', String(process.pid)], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    if (!t || t === '??' || t === '?') return null;
    return t.startsWith('/dev/') ? t : `/dev/${t}`;
  } catch {
    return null;
  }
};
