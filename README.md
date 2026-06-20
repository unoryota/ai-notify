# ai-notify

**Know the moment your terminal AI agent needs you** — a sound, a spoken read-out, and a desktop banner the instant Claude Code, Codex, or another agent finishes a turn or asks for input. One mute switch covers **all of them, across every terminal**. No daemon, no background process.

![ai-notify demo](https://raw.githubusercontent.com/unoryota/ai-notify/main/assets/demo.gif)

```sh
npm i -g ai-notify
ai-notify init        # auto-detects your agents and wires them
```

## What makes it different

Plenty of agents go quiet for minutes. ai-notify pulls you back at the right moment — and is built for **running many agents at once**:

- 🎙️ **A different voice per terminal.** Give each pane its own spoken voice, so you know *which* window finished just by listening — `export AI_NOTIFY_VOICE=Eddy` (or a [VOICEVOX](#-voicevox-character-voices) character).
- 🌐 **Read out in your language.** An agent's English reply or prompt is translated before it's spoken/shown (key-less, no cost) — great for non-English speakers.
- 📝 **It tells you *what* was done.** The "done" notification summarizes the agent's last reply (from the transcript), not just "finished".
- 🔕 **One switch mutes everything.** Every agent in every terminal reads the same flag — one tap silences them all for a meeting.
- 🔔 **A real menu bar bell, built in.** `ai-notify menubar install` — no Hammerspoon/SwiftBar required.

> ### 日本語
> 複数のAIエージェント（Claude Code / Codex …）を**並列で動かすと、どのターミナルの通知か分からない**——を解決する通知ツール。
> **ペインごとに声を変えられる**（VOICEVOXのキャラ声も）／**英語の出力を日本語に翻訳して読み上げ**／**完了通知に作業内容の要約**／**1タップで全部ミュート**（MTG用）／**メニューバーのベルも内蔵**。

## Supported agents

| Agent | Status | How it's wired |
| ----- | ------ | -------------- |
| Claude Code | ✅ | `Notification` + `Stop` hooks in `~/.claude/settings.json` |
| Codex CLI | ✅ | `notify` in `~/.codex/config.toml` (`agent-turn-complete`) |
| Gemini CLI | 🧪 detected, hook WIP | PRs welcome |

Adding another agent (aider, opencode, amp, …) is a small PR: drop a file in `src/providers/`. See [CONTRIBUTING](CONTRIBUTING.md).

## Commands

```sh
ai-notify init [--dry-run] [--only claude,codex]   # wire detected agents
ai-notify toggle | on | off | status               # the mute switch
ai-notify voice [number|name|preview|default]      # pick the spoken voice
ai-notify voicevox [on <id>|off|speakers|test]     # speak in VOICEVOX voices
ai-notify translate [on <lang>|off|test]           # speak agent text in your language
ai-notify menubar [install|uninstall|status]       # native menu bar bell (macOS)
ai-notify doctor                                   # check deps & wiring
ai-notify uninstall                                # cleanly remove wiring
```

Per-window overrides — `export` these in a terminal *before* launching the agent:

```sh
AI_NOTIFY_LABEL=api               # name this window in the read-out / notification
AI_NOTIFY_VOICE=Eddy              # this window's `say` voice
AI_NOTIFY_VOICEVOX_SPEAKER=3      # this window's VOICEVOX speaker id
```

## 🔔 One mute switch — visible and one tap away

You can't type into the terminal that's running an agent, so drive the switch from the **menu bar / a hotkey**:

```sh
ai-notify menubar install   # native menu bar 🔔/🔕 — click to toggle, starts at login
```

No third-party app needed. Prefer something else? There are drop-in recipes for **Hammerspoon**, **SwiftBar/xbar**, **Raycast**, and the built-in **macOS Shortcuts** in [`recipes/`](recipes/). `ai-notify status --icon` prints just `🔔`/`🔕` to embed in tmux / your prompt / Claude Code's status line.

> Toggling works mid-run: the flag is read the next time an agent fires, so flipping it instantly affects every running agent.

## 🎙️ VOICEVOX character voices

Speak your notifications in [VOICEVOX](https://voicevox.hiroshiba.jp/) character voices (free, local, offline). Run the VOICEVOX app, then:

```sh
ai-notify voicevox speakers     # list available characters + ids
ai-notify voicevox on 3         # use speaker 3 (e.g. ずんだもん)
```

Give every pane its own character with `AI_NOTIFY_VOICEVOX_SPEAKER`. If the engine isn't running, ai-notify silently falls back to the OS voice.
*VOICEVOX characters have their own terms of use — credit them per [VOICEVOX's guidelines](https://voicevox.hiroshiba.jp/term/) if you share recordings.*

## 🌐 Read out in your language

```sh
ai-notify translate on ja       # translate the agent's message, then speak it
ai-notify translate test "I fixed the auth bug and added 3 tests."
```

Key-less and no cost (one HTTP request; falls back to a localized template offline). The desktop banner still shows the original text.

## ⏳ Which window, and what it's asking

Each notification is titled with the window label — `⏳ <label>` when an agent is waiting, `✓ <label>` when it's done — and the body says **what** (the translated prompt, or a summary of what was done). Set a short `AI_NOTIFY_LABEL` per pane and you can tell ten terminals apart at a glance.

## How it works

A single mute flag and config under XDG paths — no daemon, no coordination:

```
${XDG_STATE_HOME:-~/.local/state}/ai-notify/muted     # presence = muted
${XDG_CONFIG_HOME:-~/.config}/ai-notify/config.json   # sounds, voice, options
```

Each agent's hook calls `ai-notify hook --source <agent>`, which reads that one flag at fire time. `ai-notify config init` writes an editable config (per-agent sounds, voice, TTS backend, translation, templates).

## Platforms

macOS is fully supported (`afplay` / `say` / VOICEVOX / `terminal-notifier` / native menu bar). Linux is best-effort (`paplay`/`canberra`, `notify-send`, `spd-say`/`espeak`, VOICEVOX). Windows plays a beep and speaks via PowerShell. Missing backends degrade silently — they never error.

## License

[MIT](LICENSE). Zero runtime dependencies.
