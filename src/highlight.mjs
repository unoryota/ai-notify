// Visually highlight the terminal window/pane that is waiting for input, so it
// stands out among many open terminals. Best-effort and terminal-specific:
//
//   - tmux              -> color the pane background (select-pane -P)
//   - Apple Terminal    -> set the tab's background color via AppleScript,
//                          matched by tty, restoring the original on done
//   - others (iTerm2,…) -> OSC 11 default-background + a tab-title marker
//
// Everything is wrapped so a failure never affects the notification. The tab
// title marker is the most portable signal and is always emitted.

import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { stateDir } from './state.mjs';
import { panesByTty, tmuxBin } from './tmux.mjs';

const isMac = process.platform === 'darwin';
const BEL = '\x07';

// Controlling terminal of this process (works even when stdio is piped).
const ttyName = () => {
  try {
    const t = execFileSync('ps', ['-o', 'tty=', '-p', String(process.pid)], { encoding: 'utf8' }).trim();
    if (!t || t === '??' || t === '?') return null;
    return t.startsWith('/dev/') ? t : `/dev/${t}`;
  } catch {
    return null;
  }
};

const writeTty = (seq) => {
  const tty = ttyName() || '/dev/tty';
  try {
    writeFileSync(tty, seq);
  } catch {
    /* no controlling terminal — ignore */
  }
};

// Default-background (OSC 11) + icon/tab title (OSC 1/2). Reset uses OSC 111.
const oscSet = (hex, title) => `\x1b]11;${hex}${BEL}\x1b]1;${title}${BEL}\x1b]2;${title}${BEL}`;
const oscReset = `\x1b]111${BEL}\x1b]1;${BEL}\x1b]2;${BEL}`;

// SGR fallback that works even where OSC is ignored (e.g. JetBrains JediTerm):
// print a bold black-on-yellow bar straight into the pane, plus a BEL so the
// IDE flags the tab as having activity. Standard ANSI — renders everywhere.
const sgrBg = { yellow: 103, orange: '48;5;208', red: 101, green: 102 };
const sgrBar = (label, color) => {
  const bg = sgrBg[color] || sgrBg.yellow;
  return `\r\n\x1b[1;30;${bg}m  ⏳ ${label || 'input'}  \x1b[0m${BEL}\r\n`;
};

// Background TINTS for the waiting pane. These flood the whole pane/terminal
// background, so they must stay DARK — a terminal's foreground text is light and
// tuned for a dark bg; a bright fill (the old #FFD400) destroys contrast and is
// unreadable. Instead we keep the bg dark and only shift its HUE, so light text
// keeps ~7:1 contrast (WCAG AA) while the pane still reads as "amber = waiting".
const colorHex = (c) => {
  const map = { yellow: '#3A3000', orange: '#3A2400', red: '#381010', green: '#0F3315' };
  if (!c) return map.yellow;
  return map[c] || (c.startsWith('#') ? c : map.yellow);
};

// --- tmux ---
const tmuxPane = () => (process.env.TMUX && process.env.TMUX_PANE ? process.env.TMUX_PANE : null);
// Dark tints (see colorHex) — a subtle hue shift on a dark bg, NOT a bright fill,
// so the pane's text stays readable. Hex needs a truecolor terminal (Ghostty,
// iTerm2, …); tmux passes it straight through.
const tmuxSet = (c) => {
  const pane = tmuxPane();
  if (!pane) return;
  const color = c && c.startsWith('#') ? c : colorHex(c);
  try {
    execFileSync(tmuxBin(), ['select-pane', '-t', pane, '-P', `bg=${color}`]);
  } catch {
    /* ignore */
  }
};
const tmuxReset = () => {
  const pane = tmuxPane();
  if (!pane) return;
  try {
    execFileSync(tmuxBin(), ['select-pane', '-t', pane, '-P', 'bg=default']);
  } catch {
    /* ignore */
  }
};

// --- Apple Terminal (set the tab bg by tty; store original to restore) ---
// Some setups don't export TERM_PROGRAM, so detect Apple Terminal robustly:
// explicit signals first, then — when the terminal is unknown — attempt anyway.
// The AppleScript matches by tty, so it's a harmless no-op if this isn't really
// a Terminal.app tab. Known non-Terminal programs (iTerm.app, vscode, …) opt out
// to avoid needless automation prompts.
const isAppleTerminal = () => {
  if (!isMac) return false;
  const tp = process.env.TERM_PROGRAM;
  const bundle = process.env.__CFBundleIdentifier || '';
  if (tp === 'Apple_Terminal' || bundle === 'com.apple.Terminal') return true;
  if (tp || bundle) return false; // a known other terminal/IDE (iTerm, WebStorm…)
  return true; // truly unknown -> attempt; the tty match guards it
};

// JetBrains IDE terminals (WebStorm, IntelliJ, …) — JediTerm/Gen2.
const isJetBrains = () =>
  process.env.TERMINAL_EMULATOR === 'JetBrains-JediTerm' ||
  /jetbrains/i.test(process.env.__CFBundleIdentifier || '');
const savePath = (tty) => join(stateDir(), `hl-${tty.replace(/[^\w]+/g, '_')}`);

const appleSet = (rgb16) => {
  const tty = ttyName();
  if (!tty) return;
  const script = `tell application "Terminal"
  repeat with w in windows
    repeat with t in tabs of w
      try
        if (tty of t) is "${tty}" then
          set c to background color of t
          set background color of t to {${rgb16}}
          return ((item 1 of c) & "," & (item 2 of c) & "," & (item 3 of c)) as string
        end if
      end try
    end repeat
  end repeat
  return ""
end tell`;
  try {
    const orig = execFileSync('osascript', ['-e', script], { encoding: 'utf8', timeout: 3000 }).trim();
    if (orig) {
      mkdirSync(stateDir(), { recursive: true });
      writeFileSync(savePath(tty), orig);
    }
  } catch {
    /* automation permission not granted / ignore */
  }
};

const appleReset = () => {
  const tty = ttyName();
  if (!tty) return;
  const p = savePath(tty);
  // Only restore if WE highlighted this tab (a saved original exists). Without
  // this guard a normal 'done' with no prior 'waiting' would blacken the tab.
  if (!existsSync(p)) return;
  let rgb16 = '0, 0, 0';
  try {
    rgb16 = readFileSync(p, 'utf8').trim() || rgb16;
  } catch {
    /* ignore */
  }
  const script = `tell application "Terminal"
  repeat with w in windows
    repeat with t in tabs of w
      try
        if (tty of t) is "${tty}" then set background color of t to {${rgb16}}
      end try
    end repeat
  end repeat
end tell`;
  try {
    execFileSync('osascript', ['-e', script], { timeout: 3000, stdio: 'ignore' });
  } catch {
    /* ignore */
  }
  try {
    if (existsSync(p)) rmSync(p);
  } catch {
    /* ignore */
  }
};

// 16-bit RGB for AppleScript — the DARK tints from colorHex (scaled ×257), so
// Apple Terminal's tab bg is dimmed-amber, not a bright fill (keeps text readable).
const rgb16From = (c) => {
  if (c === 'orange') return '14906, 9252, 0'; // #3A2400
  if (c === 'red') return '14392, 4112, 4112'; // #381010
  if (c === 'green') return '3855, 13107, 5397'; // #0F3315
  return '14906, 12336, 0'; // #3A3000 yellow
};

// A per-tty marker so `clear` only touches the terminal when WE highlighted it
// (a 'done' with no prior 'waiting' must leave the window untouched).
const markPath = (tty) => join(stateDir(), `hl-on-${tty.replace(/[^\w]+/g, '_')}`);

export const highlightWaiting = (label, color = 'yellow') => {
  writeTty(oscSet(colorHex(color), `⏳ ${label || 'input'}`));
  if (isJetBrains()) writeTty(sgrBar(label, color)); // OSC ignored here; SGR works
  if (isAppleTerminal()) appleSet(rgb16From(color));
  tmuxSet(color);
  const tty = ttyName();
  if (tty) {
    try {
      mkdirSync(stateDir(), { recursive: true });
      writeFileSync(markPath(tty), '');
    } catch {
      /* ignore */
    }
  }
};

// Foreground diagnostic: run the highlight and surface what happened (tty,
// terminal, AppleScript error/permission) instead of swallowing it.
export const diagnose = (color = 'yellow') => {
  const info = {
    platform: process.platform,
    TERM_PROGRAM: process.env.TERM_PROGRAM || null,
    __CFBundleIdentifier: process.env.__CFBundleIdentifier || null,
    isAppleTerminal: isAppleTerminal(),
    TMUX: process.env.TMUX ? process.env.TMUX_PANE || true : false,
    tty: ttyName(),
  };
  try {
    writeTty(oscSet(colorHex(color), '⏳ test'));
    info.osc = `wrote to ${ttyName() || '/dev/tty'}`;
  } catch (e) {
    info.osc = `error: ${e.message}`;
  }
  info.jetBrains = isJetBrains();
  if (isJetBrains()) {
    writeTty(sgrBar('test', color)); // should print a yellow bar right here
    info.sgrBar = 'printed (look for the yellow bar above)';
  }
  if (isAppleTerminal()) {
    const tty = ttyName();
    if (!tty) {
      info.appleTerminal = 'no controlling tty';
    } else {
      const script = `tell application "Terminal"
  repeat with w in windows
    repeat with t in tabs of w
      try
        if (tty of t) is "${tty}" then
          set c to background color of t
          set background color of t to {${rgb16From(color)}}
          return "matched tty, original=" & (c as string)
        end if
      end try
    end repeat
  end repeat
  return "no tab matched tty ${tty}"
end tell`;
      try {
        info.appleTerminal = execFileSync('osascript', ['-e', script], {
          encoding: 'utf8',
          timeout: 5000,
        }).trim();
      } catch (e) {
        info.appleTerminal = `ERROR: ${(e.stderr || e.message || '').toString().trim()}`;
      }
    }
  } else {
    info.appleTerminal = 'skipped (detected a non-Terminal program)';
  }
  return info;
};

// Self-heal stuck highlights. The normal clear runs on the 'done' hook, but if an
// agent exits WITHOUT firing it — Ctrl-C, a declined trust prompt, a crash — the
// amber fill would persist on what's now an idle shell (exactly the "yellow when
// NOT waiting" bug). So on every emit we sweep: any tmux pane WE marked
// (hl-on-<tty>) that is no longer in the waiting set gets its background reset and
// its marker dropped. Only touches panes we highlighted, never a user's own bg.
// tmux-only (the OSC/Apple paths can't target another pane after the fact).
export const sweepStaleHighlights = (waitingTtys = []) => {
  let marks;
  try {
    marks = readdirSync(stateDir()).filter((f) => f.startsWith('hl-on-'));
  } catch {
    return;
  }
  if (!marks.length) return;
  const waiting = new Set(waitingTtys);
  let panes = {};
  try {
    panes = panesByTty();
  } catch {
    /* no tmux server */
  }
  for (const [tty, info] of Object.entries(panes)) {
    if (waiting.has(tty)) continue; // legitimately still waiting
    const mark = markPath(tty);
    if (!existsSync(mark)) continue; // we didn't highlight this pane
    try {
      execFileSync(tmuxBin(), ['select-pane', '-t', info.paneId, '-P', 'bg=default']);
    } catch {
      // Reset failed (e.g. tmux unreachable) — keep the marker so a later sweep
      // retries, instead of dropping it and orphaning the tint forever.
      continue;
    }
    try {
      rmSync(mark);
    } catch {
      /* ignore */
    }
  }
};

// Force-clear THIS pane's highlight even with no saved marker. The normal
// marker-guarded clearHighlight/sweep skip an ORPHANED tint (background set, but
// the marker was lost — e.g. a failed reset dropped it) and leave the pane stuck
// amber: the "yellow when NOT waiting" bug. Called when the pane is known active
// (a new session started, or the user submitted a prompt), so resetting is safe.
export const forceClearHighlight = () => {
  writeTty(oscReset);
  tmuxReset(); // unconditional reset of $TMUX_PANE's background
  const tty = ttyName();
  if (isAppleTerminal() && tty && existsSync(savePath(tty))) appleReset();
  if (tty) {
    try {
      if (existsSync(markPath(tty))) rmSync(markPath(tty));
    } catch {
      /* ignore */
    }
  }
};

export const clearHighlight = () => {
  const tty = ttyName();
  if (tty && !existsSync(markPath(tty))) return; // we never highlighted this one
  writeTty(oscReset);
  if (isAppleTerminal()) appleReset();
  tmuxReset();
  if (tty) {
    try {
      if (existsSync(markPath(tty))) rmSync(markPath(tty));
    } catch {
      /* ignore */
    }
  }
};
