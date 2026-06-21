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

    // Tsundere baseline level 0.0 (デレ) – 1.0 (ツン). Same file the CLI reads.
    static func setTsundereLevel(_ v: Double) {
        try? FileManager.default.createDirectory(atPath: dir(), withIntermediateDirectories: true)
        try? String(format: "%.2f", v).write(toFile: file("tsundere-level"), atomically: true, encoding: .utf8)
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
    // Slider is shown reversed (left = ツン, right = デレ) but the file keeps the
    // canonical scale (0 = デレ, 1 = ツン), so write back 1 - position.
    @objc private func tsundereLevelChanged(_ s: NSSlider) { State.setTsundereLevel(1 - s.doubleValue) }
    @objc private func tsundereToggled(_ b: NSButton) { State.cli(["tsundere", "toggle"]) }
    @objc private func paneTsundereChanged(_ s: NSSlider) {
        if let tty = s.identifier?.rawValue { State.cli(["tsundere-pane", tty, String(format: "%.2f", 1 - s.doubleValue)]) }
    }
    @objc private func paneVolumeChanged(_ s: NSSlider) {
        if let tty = s.identifier?.rawValue { State.cli(["volume-pane", tty, String(format: "%.2f", s.doubleValue)]) }
    }
    // identifier carries the prosody key (speed | pitch | intonation).
    @objc private func prosodyChanged(_ s: NSSlider) {
        if let key = s.identifier?.rawValue { State.cli(["voice-prosody", key, String(format: "%.3f", s.doubleValue)]) }
    }

    // A labeled VOICEVOX base-prosody slider (speed / pitch / intonation). Applied
    // on release (one subprocess per drag avoided). The key rides in the identifier.
    private func prosodyRow(label: String, value: Double, lo: Double, hi: Double, key: String) -> NSMenuItem {
        let row = NSView(frame: NSRect(x: 0, y: 0, width: 240, height: 24))
        let cap = NSTextField(labelWithString: label)
        cap.frame = NSRect(x: 12, y: 4, width: 48, height: 16)
        cap.font = .systemFont(ofSize: 11); cap.textColor = .secondaryLabelColor
        let slider = NSSlider(value: value, minValue: lo, maxValue: hi, target: self, action: #selector(prosodyChanged(_:)))
        slider.frame = NSRect(x: 62, y: 3, width: 162, height: 20)
        slider.isContinuous = false
        slider.identifier = NSUserInterfaceItemIdentifier(key)
        row.addSubview(cap); row.addSubview(slider)
        let item = NSMenuItem(); item.view = row
        return item
    }

    // A 🔊 + slider row. identifier == nil => global (live); otherwise a pane tty
    // (applied on release to avoid a subprocess per drag tick).
    private func sliderRow(value: Double, action: Selector, identifier: String?) -> NSMenuItem {
        let row = NSView(frame: NSRect(x: 0, y: 0, width: 220, height: 26))
        let icon = NSTextField(labelWithString: "🔊"); icon.frame = NSRect(x: 12, y: 4, width: 20, height: 18)
        let slider = NSSlider(value: value, minValue: 0, maxValue: 2, target: self, action: action)
        slider.frame = NSRect(x: 36, y: 3, width: 170, height: 20)
        slider.isContinuous = (identifier == nil)
        slider.trackFillColor = .controlAccentColor // stay blue even when not focused
        if let id = identifier { slider.identifier = NSUserInterfaceItemIdentifier(id) }
        row.addSubview(icon); row.addSubview(slider)
        let item = NSMenuItem(); item.view = row
        return item
    }

    // A ツン ⇄ デレ slider for the tsundere baseline level. Shown reversed (left =
    // ツン, right = デレ) for intuition, while the file keeps 0 = デレ, 1 = ツン — so
    // the knob sits at 1 - value and writes back 1 - position. Continuous.
    private func tsundereRow(value: Double, identifier: String? = nil) -> NSMenuItem {
        let row = NSView(frame: NSRect(x: 0, y: 0, width: 220, height: 26))
        let left = NSTextField(labelWithString: "ツン")
        left.frame = NSRect(x: 12, y: 5, width: 30, height: 16)
        left.font = .systemFont(ofSize: 10); left.textColor = .secondaryLabelColor
        // identifier == nil => global (live, writes the level file); a pane tty =>
        // per-pane override applied on release (one subprocess per drag avoided).
        let action: Selector = identifier == nil ? #selector(tsundereLevelChanged(_:)) : #selector(paneTsundereChanged(_:))
        let slider = NSSlider(value: 1 - value, minValue: 0, maxValue: 1, target: self, action: action)
        slider.frame = NSRect(x: 46, y: 3, width: 128, height: 20)
        slider.isContinuous = (identifier == nil)
        slider.trackFillColor = .systemPink
        if let id = identifier { slider.identifier = NSUserInterfaceItemIdentifier(id) }
        let right = NSTextField(labelWithString: "デレ")
        right.frame = NSRect(x: 178, y: 5, width: 30, height: 16)
        right.font = .systemFont(ofSize: 10); right.textColor = .secondaryLabelColor
        row.addSubview(left); row.addSubview(slider); row.addSubview(right)
        let item = NSMenuItem(); item.view = row
        return item
    }

    // ツンデレモード on/off as a checkbox living inside a view row, so a click
    // toggles in place instead of dismissing the menu (a normal menu item closes
    // on click). The level slider below stays mounted regardless of this state, so
    // the menu height never jumps.
    private func tsundereToggleRow(on: Bool) -> NSMenuItem {
        let row = NSView(frame: NSRect(x: 0, y: 0, width: 220, height: 24))
        let btn = NSButton(checkboxWithTitle: "ツンデレモード", target: self, action: #selector(tsundereToggled(_:)))
        btn.frame = NSRect(x: 12, y: 2, width: 196, height: 20)
        btn.state = on ? .on : .off
        row.addSubview(btn)
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

        // Parse menu-json once.
        let json = (State.cli(["menu-json"], capture: true)?.data(using: .utf8))
            .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        let voices = (json?["voices"] as? [[String: Any]]) ?? []
        let panes = (json?["panes"] as? [[String: Any]]) ?? []

        // Global volume slider.
        menu.addItem(sliderRow(value: State.volume, action: #selector(volumeChanged(_:)), identifier: nil))

        // Tsundere mode: checkbox toggle + ツン⇄デレ baseline slider. Both live in
        // view rows and are always mounted, so toggling never closes the menu nor
        // shifts its height.
        let tsun = json?["tsundere"] as? [String: Any]
        let tsunOn = (tsun?["enabled"] as? Bool) ?? false
        let tsunLevel = (tsun?["level"] as? Double) ?? 0.5
        menu.addItem(tsundereToggleRow(on: tsunOn))
        menu.addItem(tsundereRow(value: tsunLevel))
        menu.addItem(.separator())

        // VOICEVOX base prosody (speed / pitch / intonation) — only when VOICEVOX
        // is the active TTS, since these are VOICEVOX audio_query scales.
        if (json?["tts"] as? String) == "voicevox" {
            let pr = json?["prosody"] as? [String: Any] ?? [:]
            let range = json?["prosodyRange"] as? [String: Any] ?? [:]
            let bounds: (String, Double, Double) -> (Double, Double) = { key, dlo, dhi in
                let r = range[key] as? [Any]
                let lo = (r?.first as? Double) ?? dlo
                let hi = (r?.last as? Double) ?? dhi
                return (lo, hi)
            }
            menu.addItem(disabledHeader("読み上げ（VOICEVOX）"))
            for (key, label, dlo, dhi, dflt) in [
                ("speed", "速さ", 0.5, 1.5, 1.0),
                ("pitch", "高さ", -0.15, 0.15, 0.0),
                ("intonation", "抑揚", 0.0, 1.5, 1.0),
            ] {
                let (lo, hi) = bounds(key, dlo, dhi)
                let v = (pr[key] as? Double) ?? dflt
                menu.addItem(prosodyRow(label: label, value: v, lo: lo, hi: hi, key: key))
            }
            menu.addItem(.separator())
        }

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
                // Per-pane tsundere baseline (same ツン⇄デレ slider as global).
                sub.addItem(disabledHeader("ツンデレ"))
                let pts = (p["tsundere"] as? Double) ?? tsunLevel
                sub.addItem(tsundereRow(value: pts, identifier: tty))
                let tsDef = NSMenuItem(title: "強さを全体に従う", action: #selector(runItem(_:)), keyEquivalent: "")
                tsDef.target = self; tsDef.representedObject = ["tsundere-pane", tty, "clear"]
                tsDef.state = (p["tsundereSet"] as? Bool ?? false) ? .off : .on
                sub.addItem(tsDef)
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
