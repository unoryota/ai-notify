// tmux bridge — map a pane's controlling tty to a tmux pane id, and inject
// keystrokes / text into that pane.
//
// This is what lets a SPOKEN command reach the RIGHT agent without focusing its
// window: `tmux send-keys -t <pane_id>` targets a pane directly, so a command
// can be delivered hands-free (from bed, the kitchen, …) to whichever agent the
// user named — no mouse, no window switching.
//
// ai-notify already keys every per-pane record (waiting.json, pane-voices.json)
// by the pane's tty (see util.controllingTty). tmux exposes that same tty as
// `#{pane_tty}`, so one `list-panes` call bridges tty -> pane id with no extra
// bookkeeping. Zero-dep: shells out to the `tmux` binary via execFileSync, the
// same style as util.mjs (controllingTty / liveAgentTtys).

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// Resolve the tmux binary. The menu bar app runs as a LaunchAgent with a minimal
// PATH (no /opt/homebrew/bin, /usr/local/bin, …), so a bare `tmux` ENOENTs there
// even though it works from an interactive shell — which is exactly why a spoken
// command "lands" (routes fine) but silently injects nothing. Probe the common
// install locations first, then fall back to PATH, and cache the result.
let TMUX_BIN;
export const tmuxBin = () => {
  if (TMUX_BIN) return TMUX_BIN;
  const candidates = [
    '/opt/homebrew/bin/tmux', // Homebrew (Apple Silicon)
    '/usr/local/bin/tmux', // Homebrew (Intel)
    '/opt/local/bin/tmux', // MacPorts
    '/usr/bin/tmux',
  ];
  TMUX_BIN = candidates.find((p) => existsSync(p)) || 'tmux';
  return TMUX_BIN;
};

const tmux = (args, { allowFail = true } = {}) => {
  try {
    return execFileSync(tmuxBin(), args, {
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 1 << 20,
    }).toString();
  } catch (e) {
    if (allowFail) return null;
    throw e;
  }
};

// Is a tmux server running and reachable? (With no server, list-panes errors.)
export const isAvailable = () => tmux(['list-panes', '-a', '-F', '#{pane_id}']) != null;

// Parse `list-panes` output (whitespace-separated: pane_tty, pane_id, title)
// into a tty -> { paneId, title } map. Pure, so it's unit-testable without a
// server. Split on ANY run of whitespace: tmux mangles a literal TAB in `-F`
// output to `_` under a minimal env (e.g. the menu bar LaunchAgent), so the
// format below uses spaces — and tty/pane_id never contain whitespace, so the
// first two tokens are always reliable; the title (last, may contain spaces)
// is rejoined.
export const parsePanes = (out) => {
  const map = {};
  if (!out) return map;
  for (const line of String(out).split('\n')) {
    const parts = line.trim().split(/\s+/);
    const [tty, paneId] = parts;
    if (tty && paneId) map[tty] = { paneId, title: parts.slice(2).join(' ') || paneId };
  }
  return map;
};

// Map every tmux pane's controlling tty -> { paneId, title } in a single call,
// so a pane recorded by tty can be targeted by send-keys. Space-delimited (not
// tab) — see parsePanes for why a TAB separator is unreliable here.
export const panesByTty = () =>
  parsePanes(
    tmux(['list-panes', '-a', '-F', '#{pane_tty} #{pane_id} #{session_name}:#{window_index}.#{pane_index}'])
  );

// The tmux pane id (e.g. "%5") whose pty is `tty` (e.g. "/dev/ttys010"), or null.
export const paneForTty = (tty) => (tty ? panesByTty()[tty]?.paneId || null : null);

// Type literal text into a pane (as if pasted) — does NOT press Enter. `--` ends
// option parsing so text beginning with `-` is sent verbatim.
const sendLiteral = (paneId, text) =>
  tmux(['send-keys', '-t', paneId, '-l', '--', text], { allowFail: false });

// Press named keys (e.g. 'Enter', 'Escape', 'Up') in a pane, in order.
const sendKeys = (paneId, ...keys) => tmux(['send-keys', '-t', paneId, ...keys], { allowFail: false });

// Inject a resolved command into a pane: type `text` literally (if any), then
// press each key in `keys` (e.g. ['Enter']). Returns true on success; throws on
// a hard tmux failure so the caller can surface it.
export const inject = (paneId, { text = '', keys = [] } = {}) => {
  if (text) sendLiteral(paneId, text);
  for (const k of keys) sendKeys(paneId, k);
  return true;
};
