# ai-notify menu bar agent (macOS)

A tiny native menu bar bell so the mute switch has a **live 🔔 / 🔕 you can
click** — with **no third-party app** (no Hammerspoon, SwiftBar, Raycast).

- `AiNotifyMenuBar.swift` — the whole agent (~120 lines, AppKit `NSStatusItem`).
- `build.sh` — compiles it into `dist/ai-notify.app` with the system `swiftc`.
  No Xcode project, no dependencies.

It reads and writes the **same mute flag** the CLI uses
(`${XDG_STATE_HOME:-~/.local/state}/ai-notify/muted`), so the icon, the CLI, and
every wired agent always agree — no daemon, no IPC.

- **Left click** — toggle mute / un-mute (one tap)
- **Right click** — menu (toggle / quit)

## Use it

```sh
ai-notify menubar install      # build if needed, run at login, show the bell
ai-notify menubar status
ai-notify menubar uninstall
```

`install` writes a per-user LaunchAgent
(`~/Library/LaunchAgents/com.ai-notify.menubar.plist`, `LimitLoadToSessionType
= Aqua`) so the bell returns automatically at every login.

## Build manually

```sh
bash menubar/build.sh                                   # ad-hoc signed, local use
CODESIGN_ID="Developer ID Application: NAME (TEAMID)" \
  bash menubar/build.sh                                 # Developer ID signed
```

## Distribution (npm)

The published tarball ships a **prebuilt** `dist/ai-notify.app`, so end users get
the bell without needing the Swift toolchain. `prepack` builds it automatically
on `npm publish` from a Mac.

Gatekeeper note: files installed by npm are **not quarantined**, so the bundled
app launches even without notarization. For a hardened release, sign with a
Developer ID and notarize:

```sh
CODESIGN_ID="Developer ID Application: NAME (TEAMID)" bash menubar/build.sh
ditto -c -k --keepParent menubar/dist/ai-notify.app /tmp/ai-notify.zip
xcrun notarytool submit /tmp/ai-notify.zip \
  --apple-id "you@example.com" --team-id TEAMID --password "APP_SPECIFIC_PW" --wait
xcrun stapler staple menubar/dist/ai-notify.app
```

On non-macOS platforms the menu bar agent is unavailable; `status --icon`
(🔔/🔕) still embeds into tmux / shell prompts / SwiftBar, and the recipes in
`../recipes/` cover Hammerspoon, SwiftBar, Raycast, and the built-in Shortcuts
app for anyone who prefers those.
