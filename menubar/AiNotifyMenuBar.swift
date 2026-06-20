// ai-notify menu bar agent — a native NSStatusItem that mirrors the shared mute
// flag and adds a volume slider and a voice picker, with no third-party app.
//
// Shared state (same files the CLI and every agent read):
//   ${XDG_STATE_HOME:-~/.local/state}/ai-notify/muted    present = muted
//   ${XDG_STATE_HOME:-~/.local/state}/ai-notify/volume   0.0–2.0 (1.0 = normal)
//   ${XDG_STATE_HOME:-~/.local/state}/ai-notify/cli       launcher -> `ai-notify`
//
// Left click  : toggle mute (one tap)
// Right click : menu — mute, volume slider, Voice ▸ (VOICEVOX + system), quit
//
// Builds with the system `swiftc` — no Xcode project, no dependencies.

import Cocoa

enum State {
    static func dir() -> String {
        let env = ProcessInfo.processInfo.environment
        let base = env["XDG_STATE_HOME"]
            ?? (NSHomeDirectory() as NSString).appendingPathComponent(".local/state")
        return (base as NSString).appendingPathComponent("ai-notify")
    }
    static func file(_ name: String) -> String { (dir() as NSString).appendingPathComponent(name) }

    static var isMuted: Bool { FileManager.default.fileExists(atPath: file("muted")) }
    static func setMuted(_ m: Bool) {
        let p = file("muted"), fm = FileManager.default
        if m { try? fm.createDirectory(atPath: dir(), withIntermediateDirectories: true); fm.createFile(atPath: p, contents: Data()) }
        else { try? fm.removeItem(atPath: p) }
    }

    static var volume: Double {
        guard let s = try? String(contentsOfFile: file("volume"), encoding: .utf8),
              let v = Double(s.trimmingCharacters(in: .whitespacesAndNewlines)) else { return 1.0 }
        return min(2, max(0, v))
    }
    static func setVolume(_ v: Double) {
        try? FileManager.default.createDirectory(atPath: dir(), withIntermediateDirectories: true)
        try? String(format: "%.2f", v).write(toFile: file("volume"), atomically: true, encoding: .utf8)
    }

    // Run the CLI launcher, capturing stdout (nil on failure).
    @discardableResult
    static func cli(_ args: [String], capture: Bool = false) -> String? {
        let launcher = file("cli")
        guard FileManager.default.isExecutableFile(atPath: launcher) else { return nil }
        let task = Process()
        task.executableURL = URL(fileURLWithPath: launcher)
        task.arguments = args
        let pipe = Pipe()
        if capture { task.standardOutput = pipe; task.standardError = Pipe() }
        do { try task.run() } catch { return nil }
        if capture {
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            task.waitUntilExit()
            return String(data: data, encoding: .utf8)
        }
        return nil
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var timer: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let b = statusItem.button {
            b.action = #selector(handleClick(_:))
            b.target = self
            b.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }
        render()
        timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in self?.render() }
    }

    private func render() { statusItem.button?.title = State.isMuted ? "🔕" : "🔔" }

    @objc private func handleClick(_ sender: Any?) {
        guard let e = NSApp.currentEvent else { toggle(); return }
        if e.type == .rightMouseUp { showMenu() } else { toggle() }
    }

    private func toggle() { State.setMuted(!State.isMuted); render() }
    @objc private func toggleFromMenu() { toggle() }
    @objc private func quit() { NSApp.terminate(nil) }

    @objc private func volumeChanged(_ s: NSSlider) { State.setVolume(s.doubleValue) }

    @objc private func pickVoice(_ item: NSMenuItem) {
        if let cmd = item.representedObject as? [String] { State.cli(cmd) }
    }

    private func showMenu() {
        let muted = State.isMuted
        let menu = NSMenu()

        let toggleItem = NSMenuItem(title: muted ? "通知をオンにする" : "ミュート", action: #selector(toggleFromMenu), keyEquivalent: "")
        toggleItem.target = self
        menu.addItem(toggleItem)

        menu.addItem(.separator())

        // Volume slider in a custom view.
        let row = NSView(frame: NSRect(x: 0, y: 0, width: 200, height: 26))
        let icon = NSTextField(labelWithString: "🔊")
        icon.frame = NSRect(x: 12, y: 4, width: 20, height: 18)
        let slider = NSSlider(value: State.volume, minValue: 0, maxValue: 2,
                              target: self, action: #selector(volumeChanged(_:)))
        slider.frame = NSRect(x: 36, y: 3, width: 150, height: 20)
        slider.isContinuous = true
        row.addSubview(icon); row.addSubview(slider)
        let volItem = NSMenuItem(); volItem.view = row
        menu.addItem(volItem)

        menu.addItem(.separator())

        // Voice submenu, populated from `cli menu-json`.
        let voiceItem = NSMenuItem(title: "声 / Voice", action: nil, keyEquivalent: "")
        voiceItem.submenu = buildVoiceMenu()
        menu.addItem(voiceItem)

        menu.addItem(.separator())
        let quitItem = NSMenuItem(title: "ai-notify を終了", action: #selector(quit), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        statusItem.menu = menu
        statusItem.button?.performClick(nil)
        statusItem.menu = nil
    }

    private func buildVoiceMenu() -> NSMenu {
        let sub = NSMenu()
        guard let out = State.cli(["menu-json"], capture: true),
              let data = out.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let voices = json["voices"] as? [[String: Any]], !voices.isEmpty
        else {
            let none = NSMenuItem(title: "(VOICEVOX/エンジン未検出)", action: nil, keyEquivalent: "")
            none.isEnabled = false
            sub.addItem(none)
            return sub
        }
        var lastSection = ""
        for v in voices {
            let section = v["section"] as? String ?? ""
            if section != lastSection {
                if !lastSection.isEmpty { sub.addItem(.separator()) }
                let header = NSMenuItem(title: section, action: nil, keyEquivalent: "")
                header.isEnabled = false
                sub.addItem(header)
                lastSection = section
            }
            let it = NSMenuItem(title: v["label"] as? String ?? "?", action: #selector(pickVoice(_:)), keyEquivalent: "")
            it.target = self
            it.state = (v["current"] as? Bool ?? false) ? .on : .off
            it.representedObject = v["cmd"] as? [String]
            sub.addItem(it)
        }
        return sub
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
