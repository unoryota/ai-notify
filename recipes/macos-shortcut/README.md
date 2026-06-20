# One-tap mute on macOS (Shortcuts.app)

Make muting every agent a single click / keypress / phone tap.

1. Open **Shortcuts.app** → **+** (new shortcut).
2. Add the action **Run Shell Script**.
   - Shell: `zsh`
   - Pass input: **to stdin** (doesn't matter; we ignore it)
   - Script:
     ```sh
     ai-notify toggle
     ```
     If `ai-notify` isn't on the GUI PATH, use the full path (find it with
     `which ai-notify`), e.g. `/usr/local/bin/ai-notify toggle` or
     `/opt/homebrew/bin/ai-notify toggle`.
3. Rename it to **"AI Notify Toggle"**.
4. In the shortcut's settings (ⓘ), enable any of:
   - **Pin in Menu Bar** → toggle from the top of the screen.
   - **Add Keyboard Shortcut** (e.g. ⌃⌥M) → works from any app.
   - It also appears on iPhone / Apple Watch / Control Center under the same Apple ID.

That's it — one tap silences (or un-silences) Claude Code, Codex, and every other
wired agent at once, because they all share the same switch.
