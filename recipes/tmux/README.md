# Show mute state in your tmux / shell prompt

If you live in tmux, put the indicator in the status bar — always visible,
across every pane, even while agents run.

`~/.tmux.conf`:

```tmux
set -g status-interval 3
set -ga status-right '#(ai-notify status --icon) '
```

Bind a key to toggle without leaving tmux (here: prefix + N):

```tmux
bind N run-shell 'ai-notify toggle'
```

## Shell prompt (zsh)

Show `🔕` in your prompt only when muted:

```zsh
ai_notify_indicator() { [ "$(ai-notify status --plain)" = muted ] && echo "🔕 "; }
setopt PROMPT_SUBST
PROMPT='$(ai_notify_indicator)'$PROMPT
```

## Starship

```toml
# ~/.config/starship.toml
[custom.ai_notify]
command = "ai-notify status --icon"
when = true
format = "[$output]($style) "
```
