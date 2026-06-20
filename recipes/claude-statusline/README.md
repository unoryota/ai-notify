# Show mute state inside Claude Code's own status line

The terminal running Claude Code is exactly the one you *can't* type into while
it's working — but Claude Code can render a **status line** at the bottom. Put
the mute indicator there, and the busy terminal shows `🔔` / `🔕` on its own.

Add this to `~/.claude/settings.json` (merge with any existing `statusLine`):

```json
{
  "statusLine": {
    "type": "command",
    "command": "ai-notify status --icon"
  }
}
```

Want more context in the line? Combine it with your own info:

```json
{
  "statusLine": {
    "type": "command",
    "command": "printf '%s  %s' \"$(ai-notify status --icon)\" \"$(basename \"$PWD\")\""
  }
}
```

> Note: Claude Code allows a single `statusLine`. If you already use one, fold
> `ai-notify status --icon` into your existing command rather than replacing it.
