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

// The controlling terminal of the agent's pane (e.g. "/dev/ttys010"), used to
// scope per-pane settings. Returns null if none can be found.
//
// Agents often run the notify hook detached (Claude Code wires it `async`), so
// the hook process itself frequently has NO controlling tty — but its parent
// (the agent, e.g. `claude`) still owns the pane's terminal. So we walk up the
// process tree until we find a real tty, which makes the hook resolve to the
// SAME tty the menu bar lists the pane under (it scans the agent process).
export const controllingTty = () => {
  let pid = process.pid;
  for (let depth = 0; depth < 8 && pid > 1; depth++) {
    try {
      const line = execFileSync('ps', ['-o', 'tty=', '-o', 'ppid=', '-p', String(pid)], {
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .toString()
        .trim();
      if (!line) return null;
      // "ttys010  1234"  or  "??  1234" (no controlling tty for this pid)
      const sp = line.lastIndexOf(' ');
      const tty = line.slice(0, sp).trim();
      const ppid = parseInt(line.slice(sp + 1).trim(), 10);
      if (tty && tty !== '??' && tty !== '?') return tty.startsWith('/dev/') ? tty : `/dev/${tty}`;
      if (!Number.isFinite(ppid) || ppid <= 1) return null;
      pid = ppid;
    } catch {
      return null;
    }
  }
  return null;
};
