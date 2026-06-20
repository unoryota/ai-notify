// ai-notify menu bar agent — native NSStatusItem, no third-party app.
//
// Shared state (same files the CLI and every agent read), under
//   ${XDG_STATE_HOME:-~/.local/state}/ai-notify/ :
//     muted   present = muted
//     volume  0.0–2.0 (1.0 = normal)
//     cli     launcher -> `ai-notify`
//
// Left click  : menu — volume slider, voice list (flat), per-pane voices, quit
// Right click : toggle mute (one tap)
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

    // Any pane waiting for input -> the icon shows a yellow status.
    static var hasWaiting: Bool {
        guard let s = try? String(contentsOfFile: file("waiting.json"), encoding: .utf8) else { return false }
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return !t.isEmpty && t != "{}" && t != "[]"
    }
    static func setVolume(_ v: Double) {
        try? FileManager.default.createDirectory(atPath: dir(), withIntermediateDirectories: true)
        try? String(format: "%.2f", v).write(toFile: file("volume"), atomically: true, encoding: .utf8)
    }

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

    // Black/white waveform silhouette (template, auto-adapting) when idle; a
    // composite with a colored status dot when waiting (yellow) or muted (red +
    // slash) — Adobe-style status-by-color.
    private func statusImage(muted: Bool, waiting: Bool) -> NSImage {
        let cfg = NSImage.SymbolConfiguration(pointSize: 15, weight: .regular)
        let sym = (NSImage(systemSymbolName: "waveform", accessibilityDescription: "ai-notify")?
            .withSymbolConfiguration(cfg)) ?? NSImage()

        if !muted && !waiting {
            sym.isTemplate = true // system tints to the menu bar color
            return sym
        }

        let dark = (statusItem.button?.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua)
        let fg: NSColor = muted ? .tertiaryLabelColor : (dark ? .white : .black)
        let size = sym.size
        let img = NSImage(size: size)
        img.lockFocus()
        let rect = NSRect(origin: .zero, size: size)
        sym.draw(in: rect)
        fg.set(); rect.fill(using: .sourceAtop) // tint the silhouette
        // status dot, top-right
        let d: CGFloat = 6
        (muted ? NSColor.systemRed : NSColor.systemYellow).set()
        NSBezierPath(ovalIn: NSRect(x: size.width - d, y: size.height - d, width: d, height: d)).fill()
        if muted { // red slash
            let s = NSBezierPath(); s.lineWidth = 1.6
            s.move(to: NSPoint(x: 1.5, y: 1.5)); s.line(to: NSPoint(x: size.width - 1.5, y: size.height - 1.5))
            NSColor.systemRed.set(); s.stroke()
        }
        img.unlockFocus()
        img.isTemplate = false
        return img
    }

    private func render() {
        guard let b = statusItem.button else { return }
        b.title = ""
        b.image = statusImage(muted: State.isMuted, waiting: State.hasWaiting)
    }

    @objc private func handleClick(_ sender: Any?) {
        guard let e = NSApp.currentEvent else { showMenu(); return }
        if e.type == .rightMouseUp { toggle() } else { showMenu() }
    }

    private func toggle() { State.setMuted(!State.isMuted); render() }
    @objc private func quit() { NSApp.terminate(nil) }

    @objc private func volumeChanged(_ s: NSSlider) { State.setVolume(s.doubleValue) }
    @objc private func paneVolumeChanged(_ s: NSSlider) {
        if let tty = s.identifier?.rawValue { State.cli(["volume-pane", tty, String(format: "%.2f", s.doubleValue)]) }
    }

    // A 🔊 + slider row. identifier == nil => global (live); otherwise a pane tty
    // (applied on release to avoid a subprocess per drag tick).
    private func sliderRow(value: Double, action: Selector, identifier: String?) -> NSMenuItem {
        let row = NSView(frame: NSRect(x: 0, y: 0, width: 220, height: 26))
        let icon = NSTextField(labelWithString: "🔊"); icon.frame = NSRect(x: 12, y: 4, width: 20, height: 18)
        let slider = NSSlider(value: value, minValue: 0, maxValue: 2, target: self, action: action)
        slider.frame = NSRect(x: 36, y: 3, width: 170, height: 20)
        slider.isContinuous = (identifier == nil)
        if let id = identifier { slider.identifier = NSUserInterfaceItemIdentifier(id) }
        row.addSubview(icon); row.addSubview(slider)
        let item = NSMenuItem(); item.view = row
        return item
    }

    // representedObject is the full CLI arg array to run.
    @objc private func runItem(_ item: NSMenuItem) {
        if let cmd = item.representedObject as? [String] { State.cli(cmd) }
    }

    private func disabledHeader(_ title: String) -> NSMenuItem {
        let it = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        it.isEnabled = false
        return it
    }

    private func showMenu() {
        let menu = NSMenu()

        // Global volume slider.
        menu.addItem(sliderRow(value: State.volume, action: #selector(volumeChanged(_:)), identifier: nil))
        menu.addItem(.separator())

        // Parse menu-json once.
        let json = (State.cli(["menu-json"], capture: true)?.data(using: .utf8))
            .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        let voices = (json?["voices"] as? [[String: Any]]) ?? []
        let panes = (json?["panes"] as? [[String: Any]]) ?? []

        if voices.isEmpty {
            menu.addItem(disabledHeader("(声の一覧を取得できません)"))
        } else {
            // Global voice list — flat, at the top level.
            menu.addItem(disabledHeader("ボイス（全体）"))
            addVoiceItems(voices, to: menu, paneTty: nil, currentPaneLabel: nil)
        }

        // Per-pane voices: one submenu per recently-active pane.
        if !panes.isEmpty {
            menu.addItem(.separator())
            menu.addItem(disabledHeader("ペイン別"))
            for p in panes {
                guard let tty = p["tty"] as? String else { continue }
                let label = p["label"] as? String ?? tty
                let cur = p["current"] as? String
                let item = NSMenuItem(title: cur != nil ? "\(label) — \(cur!)" : label, action: nil, keyEquivalent: "")
                let sub = NSMenu()
                // Per-pane volume.
                let pv = (p["volume"] as? Double) ?? State.volume
                sub.addItem(disabledHeader("音量"))
                sub.addItem(sliderRow(value: pv, action: #selector(paneVolumeChanged(_:)), identifier: tty))
                let volDef = NSMenuItem(title: "音量を全体に従う", action: #selector(runItem(_:)), keyEquivalent: "")
                volDef.target = self; volDef.representedObject = ["volume-pane", tty, "clear"]
                volDef.state = (p["volumeSet"] as? Bool ?? false) ? .off : .on
                sub.addItem(volDef)
                sub.addItem(.separator())
                // Per-pane voice.
                sub.addItem(disabledHeader("声"))
                let def = NSMenuItem(title: "デフォルト（全体に従う）", action: #selector(runItem(_:)), keyEquivalent: "")
                def.target = self; def.representedObject = ["voice-pane", tty, "clear"]; def.state = (cur == nil) ? .on : .off
                sub.addItem(def)
                addVoiceItems(voices, to: sub, paneTty: tty, currentPaneLabel: cur)
                item.submenu = sub
                menu.addItem(item)
            }
        }

        menu.addItem(.separator())
        let quitItem = NSMenuItem(title: "ai-notify を終了", action: #selector(quit), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        if let button = statusItem.button {
            menu.popUp(positioning: nil, at: NSPoint(x: 0, y: button.bounds.height + 4), in: button)
        }
    }

    // Add the voice list to `menu`. paneTty == nil => sets the global voice;
    // otherwise assigns the voice to that pane.
    private func addVoiceItems(_ voices: [[String: Any]], to menu: NSMenu, paneTty: String?, currentPaneLabel: String?) {
        var lastSection = ""
        for v in voices {
            let section = v["section"] as? String ?? ""
            let label = v["label"] as? String ?? "?"
            let kind = v["kind"] as? String ?? "say"
            let ref = v["ref"] as? String ?? ""
            if section != lastSection { menu.addItem(disabledHeader("— \(section) —")); lastSection = section }
            let it = NSMenuItem(title: label, action: #selector(runItem(_:)), keyEquivalent: "")
            it.target = self
            if let tty = paneTty {
                it.representedObject = ["voice-pane", tty, kind, ref]
                it.state = (currentPaneLabel == label) ? .on : .off
            } else {
                it.representedObject = kind == "voicevox" ? ["voicevox", "on", ref] : ["voice", ref]
                it.state = (v["currentGlobal"] as? Bool ?? false) ? .on : .off
            }
            menu.addItem(it)
        }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
