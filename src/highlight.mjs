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
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { stateDir } from './state.mjs';

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

const colorHex = (c) => {
  const map = { yellow: '#FFD400', orange: '#FF9500', red: '#FF3B30', green: '#34C759' };
  if (!c) return map.yellow;
  return map[c] || (c.startsWith('#') ? c : map.yellow);
};

// --- tmux ---
const tmuxPane = () => (process.env.TMUX && process.env.TMUX_PANE ? process.env.TMUX_PANE : null);
const tmuxSet = (c) => {
  const pane = tmuxPane();
  if (!pane) return;
  const color = c === 'yellow' || !c ? 'colour220' : c;
  try {
    execFileSync('tmux', ['select-pane', '-t', pane, '-P', `bg=${color}`]);
  } catch {
    /* ignore */
  }
};
const tmuxReset = () => {
  const pane = tmuxPane();
  if (!pane) return;
  try {
    execFileSync('tmux', ['select-pane', '-t', pane, '-P', 'bg=default']);
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
  if (tp === 'Apple_Terminal') return true;
  if (process.env.__CFBundleIdentifier === 'com.apple.Terminal') return true;
  return !tp; // unknown terminal -> try; the tty match guards it
};
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

// 16-bit RGB for AppleScript yellow-ish; reuse hex→approx for custom.
const rgb16From = (c) => {
  if (c === 'orange') return '65535, 38000, 0';
  if (c === 'red') return '65535, 15000, 12000';
  if (c === 'green') return '13000, 51000, 22000';
  return '65535, 54000, 0'; // yellow
};

// A per-tty marker so `clear` only touches the terminal when WE highlighted it
// (a 'done' with no prior 'waiting' must leave the window untouched).
const markPath = (tty) => join(stateDir(), `hl-on-${tty.replace(/[^\w]+/g, '_')}`);

export const highlightWaiting = (label, color = 'yellow') => {
  writeTty(oscSet(colorHex(color), `⏳ ${label || 'input'}`));
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
