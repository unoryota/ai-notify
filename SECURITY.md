# Security Policy

## Reporting a vulnerability

Please report security issues privately using GitHub's **"Report a vulnerability"**
(Security Advisories) on this repository, rather than opening a public issue.

We aim to acknowledge reports within a few days and to address confirmed issues
promptly.

## Scope notes

`ai-notify` edits agent config files (e.g. `~/.claude/settings.json`,
`~/.codex/config.toml`) and registers hooks that run on your machine. It bundles
no audio assets, opens no network connections by default, and stores only a mute
flag and a local config file under your XDG directories.
