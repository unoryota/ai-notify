// ai-notify menu bar agent — a tiny native NSStatusItem that mirrors the one
// shared mute flag and toggles it on click. No third-party app required.
//
// Single source of truth: the same file the CLI and every wired agent read,
//   ${XDG_STATE_HOME:-~/.local/state}/ai-notify/muted
// Present = muted (🔕). Absent = on (🔔).
//
// Left click  : toggle mute/unmute (one tap)
// Right click : menu (toggle / quit)
//
// Builds with the system `swiftc` — no Xcode project, no dependencies.

import Cocoa

// MARK: - Shared state (must match src/state.mjs)

enum State {
    static func stateDir() -> String {
        let env = ProcessInfo.processInfo.environment
        let base = env["XDG_STATE_HOME"]
            ?? (NSHomeDirectory() as NSString).appendingPathComponent(".local/state")
        return (base as NSString).appendingPathComponent("ai-notify")
    }

    static func flagPath() -> String {
        (stateDir() as NSString).appendingPathComponent("muted")
    }

    static var isMuted: Bool {
        FileManager.default.fileExists(atPath: flagPath())
    }

    static func setMuted(_ muted: Bool) {
        let path = flagPath()
        let fm = FileManager.default
        if muted {
            try? fm.createDirectory(atPath: stateDir(), withIntermediateDirectories: true)
            fm.createFile(atPath: path, contents: Data())
        } else {
            try? fm.removeItem(atPath: path)
        }
    }
}

// MARK: - App

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var timer: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            button.action = #selector(handleClick(_:))
            button.target = self
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }
        render()
        // Reconcile every second so external changes (CLI `ai-notify on/off`,
        // another tool) are reflected without any IPC.
        timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.render()
        }
    }

    private func render() {
        statusItem.button?.title = State.isMuted ? "🔕" : "🔔"
    }

    @objc private func handleClick(_ sender: Any?) {
        guard let event = NSApp.currentEvent else { toggle(); return }
        if event.type == .rightMouseUp {
            showMenu()
        } else {
            toggle()
        }
    }

    private func toggle() {
        let nowMuted = !State.isMuted
        State.setMuted(nowMuted)
        render()
        if !nowMuted { chime() } // brief confirmation on un-mute
    }

    @objc private func toggleFromMenu() { toggle() }

    @objc private func quit() { NSApp.terminate(nil) }

    private func showMenu() {
        let muted = State.isMuted
        let menu = NSMenu()
        let toggleItem = NSMenuItem(
            title: muted ? "通知をオンにする" : "ミュート",
            action: #selector(toggleFromMenu), keyEquivalent: "")
        toggleItem.target = self
        menu.addItem(toggleItem)
        menu.addItem(.separator())
        let quitItem = NSMenuItem(title: "ai-notify を終了", action: #selector(quit), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        statusItem.menu = menu
        statusItem.button?.performClick(nil)
        statusItem.menu = nil // restore left-click-to-toggle
    }

    private func chime() {
        let sound = "/System/Library/Sounds/Glass.aiff"
        guard FileManager.default.fileExists(atPath: sound) else { return }
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/afplay")
        task.arguments = ["-v", "2", sound]
        try? task.run()
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory) // no Dock icon, menu bar only
let delegate = AppDelegate()
app.delegate = delegate
app.run()
