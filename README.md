# ai-notify

**Know the moment your terminal AI agent needs you** — a sound, a spoken read-out, and a desktop banner the instant Claude Code, Codex, or another agent finishes a turn or asks for input. One mute switch covers **all of them, across every terminal**. No daemon, no background process.

Long-running agents leave you staring at a quiet terminal. `ai-notify` wires a tiny notification hook into each agent CLI you have installed, so you can look away and get pulled back exactly when there's something to do. And when you're in a meeting, **one tap silences every agent at once** — because they all read the same shared switch.

```sh
npm i -g ai-notify
ai-notify init        # auto-detects your agents and wires them
```

## Why

- **Get notified even if you never set it up.** The point is to *add* notifications. Muting is just a bonus feature on top.
- **All your agents, one switch.** Use only Claude Code? Only Codex? Both? Plus others? Same experience. The mute flag is shared, so flipping it once is global.
- **Zero friction.** No daemon. Re-run `init` anytime — it only wires what's newly detected and never clobbers your existing config.

## Supported agents

| Agent | Status | How it's wired |
| ----- | ------ | -------------- |
| Claude Code | ✅ | `Notification` + `Stop` hooks in `~/.claude/settings.json` |
| Codex CLI | ✅ | `notify` in `~/.codex/config.toml` (`agent-turn-complete`) |
| Gemini CLI | 🧪 detected, hook WIP | see [CONTRIBUTING](CONTRIBUTING.md) — PRs welcome |

Adding another agent (aider, opencode, amp, ...) is a small PR: drop a file in `src/providers/`. See [CONTRIBUTING](CONTRIBUTING.md).

## Usage

```sh
ai-notify init [--dry-run] [--only claude,codex]   # wire detected agents
ai-notify uninstall [--only ...]                   # cleanly remove wiring
ai-notify toggle | on | off | status              # the mute switch
ai-notify doctor                                   # check deps & wiring
ai-notify config [init]                            # print / write config
```

> After `init`, restart any already-running Codex session so it re-reads its config.

## One tap to mute everything

Bind a hotkey or button to `ai-notify toggle`. Ready-made recipes in [`recipes/`](recipes/):

- **macOS Shortcuts** — run `ai-notify toggle`, then pin it to the menu bar or assign a global hotkey (also fires from iPhone / Apple Watch). See [recipes/macos-shortcut](recipes/macos-shortcut/).
- **Raycast** — drop-in script command: [recipes/raycast](recipes/raycast/).
- **Stream Deck / shell alias** — same one-liner.

## How it works

`ai-notify` keeps a single mute flag and config under XDG paths:

```
${XDG_STATE_HOME:-~/.local/state}/ai-notify/muted     # presence = muted
${XDG_CONFIG_HOME:-~/.config}/ai-notify/config.json   # sounds, voice, options
```

Each agent's hook calls `ai-notify hook --source <agent>`, which reads that one flag at fire time. That's why every agent and every terminal stay in sync with no coordination.

### Configuration

`ai-notify config init` writes a config you can edit — per-agent sounds and voice, whether the desktop banner still shows while muted, and whether to speak a read-out. Sounds default to OS built-ins, so nothing is bundled.

## Platforms

macOS is fully supported (`afplay` / `say` / `terminal-notifier` or `osascript`). Linux is best-effort (`paplay`/`canberra`, `notify-send`, `spd-say`/`espeak`). Windows plays a beep and speaks via PowerShell. Missing backends degrade silently — they never error.

## License

[MIT](LICENSE).
