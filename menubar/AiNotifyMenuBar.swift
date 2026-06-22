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

    // The "waiting" character popup: a flag file toggles it, an optional file
    // holds a custom character image path. Same plain-file pattern as the others.
    static var popupEnabled: Bool { FileManager.default.fileExists(atPath: file("popup")) }
    static var popupImage: String? {
        guard let s = try? String(contentsOfFile: file("popup-image"), encoding: .utf8) else { return nil }
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }

    // Numbers/strings for the popup threshold + reason filtering.
    static var popupDelayMs: Double {
        guard let s = try? String(contentsOfFile: file("popup-delay"), encoding: .utf8),
              let v = Double(s.trimmingCharacters(in: .whitespacesAndNewlines)) else { return 0 }
        return max(0, v) * 1000
    }
    static var popupIgnoreWords: [String] {
        popupIgnoreRaw.lowercased().split(whereSeparator: { $0 == "," || $0 == "\n" })
            .map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }
    static var popupIgnoreRaw: String {
        (try? String(contentsOfFile: file("popup-ignore"), encoding: .utf8))?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }
    static var popupDelaySec: Int { Int((popupDelayMs / 1000).rounded()) }

    static func json(_ name: String) -> [String: Any] {
        (try? Data(contentsOf: URL(fileURLWithPath: file(name))))
            .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
    }

    // The cached portrait file for a pane's VOICEVOX voice, if it has one and the
    // portrait was synced (`ai-notify popup portraits`). nil => no voice portrait.
    static func voicePortrait(_ tty: String) -> String? {
        guard let pv = json("pane-voices.json")[tty] as? [String: Any],
              (pv["tts"] as? String) == "voicevox",
              let sp = pv["speaker"] as? NSNumber else { return nil }
        let p = file("portraits/\(sp.intValue).png")
        return FileManager.default.fileExists(atPath: p) ? p : nil
    }

    // Panes currently waiting for input (most-recent first): name, start time,
    // reason message, and its voice's portrait path (if any). Handles both the
    // old (number) and new ({ts,msg}) waiting.json value shapes.
    static func waitingPanes() -> [(tty: String, name: String, ts: Double, msg: String, portrait: String?)] {
        let waiting = json("waiting.json")
        if waiting.isEmpty { return [] }
        let voices = json("pane-voices.json")
        let panes = json("panes.json")
        func tsmsg(_ v: Any) -> (Double, String) {
            if let n = v as? NSNumber { return (n.doubleValue, "") }
            if let d = v as? [String: Any] { return (((d["ts"] as? NSNumber)?.doubleValue) ?? 0, (d["msg"] as? String) ?? "") }
            return (0, "")
        }
        return waiting
            .map { (tty: $0.key, tm: tsmsg($0.value)) }
            .sorted { $0.tm.0 > $1.tm.0 }
            .map { item in
                let short = item.tty.replacingOccurrences(of: "/dev/", with: "")
                let name = ((voices[item.tty] as? [String: Any])?["speakName"] as? String)
                    ?? ((panes[item.tty] as? [String: Any])?["label"] as? String)
                    ?? short
                return (item.tty, name.isEmpty ? short : name, item.tm.0, item.tm.1, voicePortrait(item.tty))
            }
    }

    // Per-kind notification toggles (must mirror state.mjs defaults).
    static func notifyKinds() -> [(key: String, label: String, on: Bool)] {
        let defaults: [String: Bool] = ["input": true, "permission": true, "info": false, "done": true, "subagent-done": false]
        let labels = ["input": "入力待ち", "permission": "許可待ち", "info": "その他の通知", "done": "完了", "subagent-done": "サブエージェント完了"]
        let saved = json("notify-kinds.json")
        return ["input", "permission", "info", "done", "subagent-done"].map { k in
            (k, labels[k] ?? k, (saved[k] as? Bool) ?? defaults[k] ?? true)
        }
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

// A card view that reliably dismisses on click even when its window isn't the
// active app (a gesture recognizer on a non-key floating window is unreliable;
// acceptsFirstMouse + mouseDown is not).
final class ClickableCardView: NSView {
    var onClick: () -> Void = {}
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) { onClick() }
}

// One floating "応答待ち" card, built once and updated in place.
final class PopupCard: NSObject {
    let window: NSWindow
    private let imageView = NSImageView()
    private let face = NSTextField(labelWithString: "(｡･ω･｡)ﾉ")
    private let label = NSTextField(wrappingLabelWithString: "")
    var onClick: () -> Void = {}

    override init() {
        // A non-activating floating panel: it receives clicks (the close button
        // and the card's mouseDown both fire) without the background menu-bar app
        // ever becoming active — the reliable way to make a HUD-style window
        // clickable. A plain NSWindow drops the first click while inactive.
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 300, height: 96),
                            styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isFloatingPanel = true
        panel.becomesKeyOnlyIfNeeded = true
        panel.worksWhenModal = true
        window = panel
        super.init()
        window.isOpaque = false
        window.backgroundColor = .clear
        window.level = .floating
        window.hasShadow = true
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        window.ignoresMouseEvents = false

        let card = ClickableCardView(frame: NSRect(x: 0, y: 0, width: 300, height: 96))
        card.onClick = { [weak self] in self?.onClick() }
        card.wantsLayer = true
        card.layer?.cornerRadius = 16
        card.layer?.backgroundColor = NSColor(calibratedWhite: 0.10, alpha: 0.95).cgColor
        card.layer?.borderWidth = 2
        card.layer?.borderColor = NSColor.systemYellow.withAlphaComponent(0.9).cgColor

        imageView.frame = NSRect(x: 12, y: 12, width: 72, height: 72)
        imageView.imageScaling = .scaleProportionallyUpOrDown
        imageView.isHidden = true
        card.addSubview(imageView)

        face.frame = NSRect(x: 8, y: 30, width: 80, height: 36)
        face.alignment = .center
        face.font = .systemFont(ofSize: 17, weight: .semibold)
        face.textColor = .systemYellow
        card.addSubview(face)

        let badge = NSTextField(labelWithString: "🟡 応答待ち")
        badge.frame = NSRect(x: 96, y: 56, width: 150, height: 22)
        badge.font = .systemFont(ofSize: 13, weight: .bold)
        badge.textColor = .systemYellow
        badge.isBordered = false
        badge.backgroundColor = .clear
        card.addSubview(badge)

        label.frame = NSRect(x: 96, y: 12, width: 196, height: 44)
        label.font = .systemFont(ofSize: 15, weight: .semibold)
        label.textColor = .white
        label.maximumNumberOfLines = 2
        label.isBordered = false
        label.backgroundColor = .clear
        card.addSubview(label)

        // Visible close button (✕) at the top-right.
        let close = NSButton(frame: NSRect(x: 272, y: 70, width: 20, height: 20))
        close.title = "✕"
        close.font = .systemFont(ofSize: 11, weight: .bold)
        close.isBordered = false
        close.contentTintColor = .secondaryLabelColor
        close.setButtonType(.momentaryChange)
        close.target = self
        close.action = #selector(clicked)
        card.addSubview(close)

        window.contentView = card
    }

    @objc private func clicked() { onClick() }

    func update(text: String, image: NSImage?) {
        label.stringValue = text
        if let img = image {
            imageView.image = img
            imageView.isHidden = false
            face.isHidden = true
        } else {
            imageView.isHidden = true
            face.isHidden = false
        }
    }
}

// One settings row: a label (or checkbox) + a slider + an editable numeric field,
// kept on a single shared grid so every row lines up. The slider and the field
// stay in sync; both call `onChange`.
final class SettingsRow: NSObject {
    let view = NSView(frame: NSRect(x: 0, y: 0, width: 470, height: 32))
    private let slider: NSSlider
    private let field = NSTextField()
    private let lo: Double
    private let hi: Double
    private let onChange: (Double) -> Void
    private let onToggle: (() -> Void)?

    init(title: String, asCheckbox: Bool, on: Bool, lo: Double, hi: Double, value: Double,
         fill: NSColor, onToggle: (() -> Void)? = nil, onChange: @escaping (Double) -> Void) {
        self.lo = lo; self.hi = hi; self.onChange = onChange; self.onToggle = onToggle
        slider = NSSlider(value: value, minValue: lo, maxValue: hi, target: nil, action: nil)
        super.init()

        if asCheckbox {
            let cb = NSButton(checkboxWithTitle: title, target: self, action: #selector(toggled))
            cb.frame = NSRect(x: 16, y: 6, width: 106, height: 20)
            cb.state = on ? .on : .off
            view.addSubview(cb)
        } else {
            let lbl = NSTextField(labelWithString: title)
            lbl.frame = NSRect(x: 16, y: 7, width: 106, height: 18)
            lbl.textColor = .labelColor
            view.addSubview(lbl)
        }
        // Unified grid: slider always at the same x/width, field always after it.
        slider.frame = NSRect(x: 128, y: 5, width: 250, height: 20)
        slider.trackFillColor = fill // blue (a settings window is key, so it stays colored)
        slider.minValue = lo; slider.maxValue = hi; slider.doubleValue = value
        slider.target = self; slider.action = #selector(sliderMoved)
        slider.isContinuous = true
        view.addSubview(slider)

        field.frame = NSRect(x: 392, y: 5, width: 56, height: 20)
        field.alignment = .right
        field.target = self; field.action = #selector(fieldEdited)
        view.addSubview(field)
        setField(value)
    }

    private func setField(_ v: Double) { field.stringValue = String(format: "%.2f", v) }
    @objc private func toggled() { onToggle?() }
    @objc private func sliderMoved() { setField(slider.doubleValue); onChange(slider.doubleValue) }
    @objc private func fieldEdited() {
        var v = Double(field.stringValue) ?? slider.doubleValue
        v = min(hi, max(lo, v))
        slider.doubleValue = v; setField(v); onChange(v)
    }
}

// The settings window: aligned sliders + editable numeric fields for volume,
// tsundere, war, and the VOICEVOX prosody, plus a saveable preset bar.
final class SettingsWindowController: NSObject {
    private var window: NSWindow?
    private var presetPopup: NSPopUpButton?
    var windowNumber: Int { window?.windowNumber ?? 0 }

    func show() {
        if window == nil { build() }
        reloadValues()
        NSApp.activate(ignoringOtherApps: true)
        window?.center()
        window?.makeKeyAndOrderFront(nil)
        window?.orderFrontRegardless()
    }

    private func menuJSON() -> [String: Any] {
        (State.cli(["menu-json"], capture: true)?.data(using: .utf8))
            .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
    }

    private func build() {
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 470, height: 360),
                         styleMask: [.titled, .closable], backing: .buffered, defer: false)
        w.title = "ai-notify 設定"
        w.isReleasedWhenClosed = false
        window = w
        rebuildContent()
    }

    // Re-create the rows from the current state (also used after loading a preset).
    private func rebuildContent() {
        guard let w = window else { return }
        let j = menuJSON()
        let content = NSView(frame: NSRect(x: 0, y: 0, width: 470, height: 360))

        // Preset bar.
        let presetLabel = NSTextField(labelWithString: "プリセット")
        presetLabel.frame = NSRect(x: 16, y: 322, width: 70, height: 18)
        content.addSubview(presetLabel)
        let popup = NSPopUpButton(frame: NSRect(x: 92, y: 318, width: 180, height: 26))
        for name in presetNames() { popup.addItem(withTitle: name) }
        if popup.numberOfItems == 0 { popup.addItem(withTitle: "(なし)"); popup.isEnabled = false }
        content.addSubview(popup)
        presetPopup = popup
        let apply = NSButton(title: "適用", target: self, action: #selector(applyPreset)); apply.frame = NSRect(x: 278, y: 318, width: 52, height: 26); apply.bezelStyle = .rounded; content.addSubview(apply)
        let save = NSButton(title: "保存…", target: self, action: #selector(savePreset)); save.frame = NSRect(x: 332, y: 318, width: 60, height: 26); save.bezelStyle = .rounded; content.addSubview(save)
        let del = NSButton(title: "削除", target: self, action: #selector(deletePreset)); del.frame = NSRect(x: 394, y: 318, width: 52, height: 26); del.bezelStyle = .rounded; content.addSubview(del)

        let sep = NSBox(frame: NSRect(x: 12, y: 306, width: 446, height: 1)); sep.boxType = .separator; content.addSubview(sep)

        // Parameter rows (top-down).
        let blue = NSColor(srgbRed: 0, green: 122.0 / 255.0, blue: 1, alpha: 1)
        let tsun = j["tsundere"] as? [String: Any]
        let warj = j["war"] as? [String: Any]
        let pr = j["prosody"] as? [String: Any] ?? [:]
        let range = j["prosodyRange"] as? [String: Any] ?? [:]
        func bound(_ key: String, _ dlo: Double, _ dhi: Double) -> (Double, Double) {
            let r = range[key] as? [Any]
            return ((r?.first as? Double) ?? dlo, (r?.last as? Double) ?? dhi)
        }
        let (slo, shi) = bound("speed", 0.5, 1.5)
        let (plo, phi) = bound("pitch", -0.15, 0.15)
        let (ilo, ihi) = bound("intonation", 0.0, 1.5)

        let rows: [SettingsRow] = [
            SettingsRow(title: "音量", asCheckbox: false, on: false, lo: 0, hi: 2, value: (j["volume"] as? Double) ?? 1, fill: blue,
                        onChange: { State.cli(["volume", String(format: "%.2f", $0)]) }),
            // Reversed: field/knob left(0)=ツン … right(1)=デレ, while the file keeps 0=デレ…1=ツン.
            SettingsRow(title: "ツンデレ", asCheckbox: false, on: false, lo: 0, hi: 1, value: 1 - ((tsun?["level"] as? Double) ?? 0.5), fill: blue,
                        onChange: { State.cli(["tsundere", "level", String(format: "%.2f", 1 - $0)]) }),
            SettingsRow(title: "心理的安全性", asCheckbox: false, on: false, lo: 0, hi: 1, value: (warj?["level"] as? Double) ?? 0.5, fill: blue,
                        onChange: { State.cli(["war", "level", String(format: "%.2f", $0)]) }),
            SettingsRow(title: "速さ", asCheckbox: false, on: false, lo: slo, hi: shi, value: (pr["speed"] as? Double) ?? 1, fill: blue,
                        onChange: { State.cli(["voice-prosody", "speed", String(format: "%.3f", $0)]) }),
            SettingsRow(title: "高さ", asCheckbox: false, on: false, lo: plo, hi: phi, value: (pr["pitch"] as? Double) ?? 0, fill: blue,
                        onChange: { State.cli(["voice-prosody", "pitch", String(format: "%.3f", $0)]) }),
            SettingsRow(title: "抑揚", asCheckbox: false, on: false, lo: ilo, hi: ihi, value: (pr["intonation"] as? Double) ?? 1, fill: blue,
                        onChange: { State.cli(["voice-prosody", "intonation", String(format: "%.3f", $0)]) }),
        ]
        var y = 264
        let header = NSTextField(labelWithString: "中央=OFF。ツンデレ=左ツン⇔右デレ　心理的安全性=左スパルタ軍隊⇔右ホワイト企業")
        header.frame = NSRect(x: 16, y: 286, width: 440, height: 16)
        header.font = .systemFont(ofSize: 11); header.textColor = .secondaryLabelColor
        content.addSubview(header)
        for r in rows {
            r.view.frame.origin = NSPoint(x: 0, y: CGFloat(y))
            content.addSubview(r.view)
            self.rows.append(r) // retain
            y -= 36
        }
        w.contentView = content
    }

    private var rows: [SettingsRow] = []

    private func presetNames() -> [String] {
        let out = State.cli(["preset", "list"], capture: true) ?? ""
        return out.split(separator: "\n").map { String($0).trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty && $0 != "(no presets)" }
    }

    private func reloadValues() {
        rows.removeAll()
        rebuildContent()
    }

    @objc private func applyPreset() {
        guard let name = presetPopup?.titleOfSelectedItem, name != "(なし)" else { return }
        State.cli(["preset", "load", name])
        reloadValues()
    }
    @objc private func deletePreset() {
        guard let name = presetPopup?.titleOfSelectedItem, name != "(なし)" else { return }
        State.cli(["preset", "delete", name])
        reloadValues()
    }
    @objc private func savePreset() {
        let alert = NSAlert()
        alert.messageText = "プリセットを保存"
        alert.informativeText = "現在の音量・ツンデレ・戦争・読み上げ設定を名前を付けて保存します"
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 240, height: 24))
        field.placeholderString = "例: 集中モード"
        alert.accessoryView = field
        alert.addButton(withTitle: "保存"); alert.addButton(withTitle: "キャンセル")
        alert.window.initialFirstResponder = field
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let name = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        State.cli(["preset", "save", name])
        reloadValues()
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var timer: Timer?
    private let settings = SettingsWindowController()

    // The "waiting for input" popup — one floating card per waiting pane.
    private var waitingCards: [String: PopupCard] = [:] // keyed by tty
    private var dismissedTtys: Set<String> = []          // clicked away; reshow on the next wait

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let b = statusItem.button {
            b.action = #selector(handleClick(_:))
            b.target = self
            b.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }
        render()
        timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.render()
            self?.updateWaitingPopup()
        }

        var shotPath = ProcessInfo.processInfo.environment["AI_NOTIFY_SHOT"]
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "--shot"), i + 1 < args.count { shotPath = args[i + 1] }
        var shotTarget = ProcessInfo.processInfo.environment["AI_NOTIFY_SHOT_TARGET"] ?? "menu"
        if let i = args.firstIndex(of: "--shot-target"), i + 1 < args.count { shotTarget = args[i + 1] }
        if let shot = shotPath, !shot.isEmpty {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                if shotTarget == "settings" { self?.captureSettingsShot(shot) } else { self?.captureMenuShot(shot) }
            }
        }
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

    // --- "Waiting for input" popup (one card per waiting pane) ------------
    // Driven off the 1s timer. Each waiting pane gets its own floating card,
    // showing its name and — when the pane's voice is a VOICEVOX character —
    // that character's portrait. Cards stack at the bottom-right and disappear
    // the moment their pane stops waiting (or you click one away).
    private func updateWaitingPopup() {
        var panes: [(tty: String, name: String, ts: Double, msg: String, portrait: String?)] = []
        if State.popupEnabled {
            let now = Date().timeIntervalSince1970 * 1000
            let delayMs = State.popupDelayMs
            let ignore = State.popupIgnoreWords
            panes = State.waitingPanes().filter { p in
                if now - p.ts < delayMs { return false } // hasn't waited long enough yet
                if !ignore.isEmpty {
                    let m = p.msg.lowercased()
                    if ignore.contains(where: { m.contains($0) }) { return false } // a skipped reason
                }
                return true
            }
        }
        let activeTtys = Set(panes.map { $0.tty })
        dismissedTtys.formIntersection(activeTtys) // a pane that re-enters waiting shows again

        let visible = panes.filter { !dismissedTtys.contains($0.tty) }
        let visibleTtys = Set(visible.map { $0.tty })
        // Tear down cards for panes that are no longer shown.
        for (tty, card) in waitingCards where !visibleTtys.contains(tty) {
            card.window.orderOut(nil)
            waitingCards.removeValue(forKey: tty)
        }
        // NSScreen.main is nil for a background app with no focused window — fall
        // back to the first screen so the cards always have somewhere to land.
        guard let scr = NSScreen.main ?? NSScreen.screens.first else { return }
        let margin: CGFloat = 24, gap: CGFloat = 12, h: CGFloat = 96, w: CGFloat = 300
        for (i, p) in visible.prefix(6).enumerated() {
            let card: PopupCard
            if let existing = waitingCards[p.tty] {
                card = existing
            } else {
                let c = PopupCard()
                let tty = p.tty
                c.onClick = { [weak self] in
                    self?.dismissedTtys.insert(tty)
                    self?.waitingCards[tty]?.window.orderOut(nil)
                    self?.waitingCards.removeValue(forKey: tty)
                }
                waitingCards[p.tty] = c
                card = c
            }
            // Image priority: the voice's portrait (head-cropped) > a global popup
            // image > the default kaomoji (image == nil).
            var img: NSImage?
            if let pp = p.portrait { img = faceCrop(path: pp) }
            else if let gp = State.popupImage { img = NSImage(contentsOfFile: gp) }
            card.update(text: "\(p.name) は応答待ち！", image: img)
            card.window.setFrameOrigin(NSPoint(x: scr.visibleFrame.maxX - w - margin,
                                               y: scr.visibleFrame.minY + margin + CGFloat(i) * (h + gap)))
            card.window.orderFront(nil)
        }
    }

    // Crop a full-body VOICEVOX portrait down to the head (top-center) so it
    // reads at card size. Heuristic fractions that fit the standard 立ち絵.
    private func faceCrop(path: String) -> NSImage? {
        guard let src = NSImage(contentsOfFile: path),
              let cg = src.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return nil }
        let W = CGFloat(cg.width), H = CGFloat(cg.height)
        let rect = CGRect(x: W * 0.18, y: H * 0.03, width: W * 0.64, height: H * 0.30)
        guard let cropped = cg.cropping(to: rect) else { return src }
        return NSImage(cgImage: cropped, size: NSSize(width: rect.width, height: rect.height))
    }

    private func toggle() { State.setMuted(!State.isMuted); render() }
    @objc private func quit() { NSApp.terminate(nil) }
    @objc private func openSettings() { settings.show() }

    @objc private func volumeChanged(_ s: NSSlider) { State.setVolume(s.doubleValue) }
    // The slider is shown REVERSED: left = ツン (far-left = 極寒), center = off, right =
    // デレ (far-right = デレデレ). The file keeps the canonical scale (0 = デレ … 1 = ツン),
    // so the knob sits at 1 - value and we write back 1 - position.
    @objc private func tsundereLevelChanged(_ s: NSSlider) { State.setTsundereLevel(1 - s.doubleValue) }
    @objc private func tsundereToggled(_ sender: Any) { State.cli(["tsundere", "toggle"]) }
    @objc private func paneTsundereChanged(_ s: NSSlider) {
        if let tty = s.identifier?.rawValue { State.cli(["tsundere-pane", tty, String(format: "%.2f", 1 - s.doubleValue)]) }
    }
    @objc private func paneVolumeChanged(_ s: NSSlider) {
        if let tty = s.identifier?.rawValue { State.cli(["volume-pane", tty, String(format: "%.2f", s.doubleValue)]) }
    }
    @objc private func paneWarChanged(_ s: NSSlider) {
        if let tty = s.identifier?.rawValue { State.cli(["war-pane", tty, String(format: "%.2f", s.doubleValue)]) }
    }
    @objc private func paneProsodyChanged(_ s: NSSlider) {
        guard let id = s.identifier?.rawValue else { return }
        let parts = id.split(separator: "\u{1}", maxSplits: 1).map(String.init)
        if parts.count == 2 { State.cli(["prosody-pane", parts[0], parts[1], String(format: "%.3f", s.doubleValue)]) }
    }

    // A blue per-pane slider carrying its target id in `identifier`.
    private func paneLevelRow(value: Double, lo: Double, hi: Double, action: Selector, id: String) -> NSMenuItem {
        let row = NSView(frame: NSRect(x: 0, y: 0, width: 240, height: 24))
        let slider = NSSlider(value: value, minValue: lo, maxValue: hi, target: self, action: action)
        slider.frame = NSRect(x: 12, y: 3, width: 212, height: 20)
        slider.isContinuous = false
        slider.identifier = NSUserInterfaceItemIdentifier(id)
        row.addSubview(slider)
        let item = NSMenuItem(); item.view = row
        return item
    }
    // Editing a text field *inside* an NSMenu is unreliable — the menu's tracking
    // loop swallows the keystrokes. So naming a pane opens a normal modal dialog
    // (NSAlert with a text field), which takes keyboard focus properly. Empty =>
    // clear (the pane falls back to its label / the speakLabel default).
    // Edit the popup "ignore" reason-keywords from the menu (a modal text field,
    // since menus can't host an editable field). Empty clears the filter.
    @objc private func promptPopupIgnore() {
        let alert = NSAlert()
        alert.messageText = "無視ワード"
        alert.informativeText = "待ち理由メッセージにこの語を含む通知はポップアップしません（カンマ区切り・空欄で解除）"
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
        field.stringValue = State.popupIgnoreRaw
        field.placeholderString = "例: subagent,task"
        alert.accessoryView = field
        alert.addButton(withTitle: "保存")
        alert.addButton(withTitle: "キャンセル")
        NSApp.activate(ignoringOtherApps: true)
        alert.window.initialFirstResponder = field
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let v = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        State.cli(["popup", "ignore", v.isEmpty ? "clear" : v])
    }

    @objc private func promptPaneName(_ sender: NSMenuItem) {
        guard let info = sender.representedObject as? [String], let tty = info.first else { return }
        let current = info.count > 1 ? info[1] : ""
        let alert = NSAlert()
        alert.messageText = "読み上げ名"
        alert.informativeText = "このペインを通知で読み上げる名前（空欄で解除）"
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 240, height: 24))
        field.stringValue = current
        field.placeholderString = "例: バックエンド"
        alert.accessoryView = field
        alert.addButton(withTitle: "保存")
        alert.addButton(withTitle: "キャンセル")
        NSApp.activate(ignoringOtherApps: true)
        alert.window.initialFirstResponder = field
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let name = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        State.cli(["name-pane", tty, name.isEmpty ? "clear" : name])
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
        if let id = identifier { slider.identifier = NSUserInterfaceItemIdentifier(id) }
        row.addSubview(icon); row.addSubview(slider)
        let item = NSMenuItem(); item.view = row
        return item
    }

    // A ツン ⇄ デレ slider for the tsundere baseline level. Shown REVERSED (left = ツン,
    // far-left = 極寒; center = off; right = デレ, far-right = デレデレ) while the file
    // keeps 0 = デレ, 1 = ツン — so the knob sits at 1 - value and writes back 1 - pos.
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
        if let id = identifier { slider.identifier = NSUserInterfaceItemIdentifier(id) }
        let right = NSTextField(labelWithString: "デレ")
        right.frame = NSRect(x: 178, y: 5, width: 30, height: 16)
        right.font = .systemFont(ofSize: 10); right.textColor = .secondaryLabelColor
        row.addSubview(left); row.addSubview(slider); row.addSubview(right)
        let item = NSMenuItem(); item.view = row
        return item
    }

    // A master ON/OFF toggle SWITCH (NSSwitch) for a read-out skin, in a view row
    // so a tap flips it in place without closing the menu. The skin's slider sits
    // right below it (tone/intensity); this switch is the master enable.
    private func toggleSwitchRow(_ label: String, on: Bool, action: Selector) -> NSMenuItem {
        let row = NSView(frame: NSRect(x: 0, y: 0, width: 240, height: 28))
        let cap = NSTextField(labelWithString: label)
        cap.frame = NSRect(x: 12, y: 6, width: 160, height: 16)
        cap.font = .systemFont(ofSize: 12)
        let sw = NSSwitch(frame: NSRect(x: 182, y: 3, width: 42, height: 22))
        sw.state = on ? .on : .off
        sw.target = self
        sw.action = action
        row.addSubview(cap); row.addSubview(sw)
        let item = NSMenuItem(); item.view = row
        return item
    }

    // A labeled blue level slider (0–1), laid out like the 速さ/高さ/抑揚 rows so
    // ツンデレ / 心理的安全性 sit with them, aligned and in the same blue.
    private func levelRow(label: String, value: Double, action: Selector) -> NSMenuItem {
        let row = NSView(frame: NSRect(x: 0, y: 0, width: 240, height: 24))
        let cap = NSTextField(labelWithString: label)
        cap.frame = NSRect(x: 12, y: 4, width: 64, height: 16)
        cap.font = .systemFont(ofSize: 11); cap.textColor = .secondaryLabelColor
        // Plain NSSlider (same as the 速さ/高さ/抑揚 rows, which track + render blue
        // correctly). A custom-cell slider was dropping the dragged value.
        let slider = NSSlider(value: value, minValue: 0, maxValue: 1, target: self, action: action)
        slider.frame = NSRect(x: 78, y: 3, width: 146, height: 20)
        slider.isContinuous = false
        row.addSubview(cap); row.addSubview(slider)
        let item = NSMenuItem(); item.view = row
        return item
    }

    @objc private func warToggled(_ sender: Any) { State.cli(["war", "toggle"]) }
    @objc private func warLevelChanged(_ s: NSSlider) { State.cli(["war", "level", String(format: "%.2f", s.doubleValue)]) }
    // Reversed like the other tsundere sliders: left = ツン, right = デレ → write 1 - pos.
    @objc private func tsundereLevelDirect(_ s: NSSlider) { State.cli(["tsundere", "level", String(format: "%.2f", 1 - s.doubleValue)]) }

    // representedObject is the full CLI arg array to run.
    @objc private func runItem(_ item: NSMenuItem) {
        if let cmd = item.representedObject as? [String] { State.cli(cmd) }
    }

    private func disabledHeader(_ title: String) -> NSMenuItem {
        let it = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        it.isEnabled = false
        return it
    }

    private func buildMenu() -> NSMenu {
        let menu = NSMenu()

        // Parse menu-json once.
        let json = (State.cli(["menu-json"], capture: true)?.data(using: .utf8))
            .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        let voices = (json?["voices"] as? [[String: Any]]) ?? []
        let panes = (json?["panes"] as? [[String: Any]]) ?? []

        // Global volume slider.
        menu.addItem(sliderRow(value: State.volume, action: #selector(volumeChanged(_:)), identifier: nil))
        menu.addItem(.separator())

        // ツンデレ / 心理的安全性: each is a master ON/OFF switch + a bipolar slider
        // (center = off). The switches + sliders sit below with 速さ/高さ/抑揚.
        let tsun = json?["tsundere"] as? [String: Any]
        let tsunLevel = (tsun?["level"] as? Double) ?? 0.5
        let tsunOn = (tsun?["enabled"] as? Bool) ?? false
        let warJson = json?["war"] as? [String: Any]
        let warLevel = (warJson?["level"] as? Double) ?? 0.5
        let warOn = (warJson?["enabled"] as? Bool) ?? false

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
        }
        // ツンデレ + 心理的安全性: master switch then its bipolar slider, below 速さ/高さ/抑揚.
        // ツンデレ slider is reversed (left=ツン, right=デレ) so the knob sits at 1 - level.
        // 心理的安全性 slider is direct (left=スパルタ/0, right=ホワイト/1, center=off).
        menu.addItem(toggleSwitchRow("ツンデレ", on: tsunOn, action: #selector(tsundereToggled(_:))))
        menu.addItem(levelRow(label: "　└ ツン/デレ", value: 1 - tsunLevel, action: #selector(tsundereLevelDirect(_:))))
        menu.addItem(toggleSwitchRow("心理的安全性", on: warOn, action: #selector(warToggled(_:))))
        menu.addItem(levelRow(label: "　└ ｽﾊﾟﾙﾀ/ﾎﾜｲﾄ", value: warLevel, action: #selector(warLevelChanged(_:))))
        menu.addItem(.separator())

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
                let pname = p["speakName"] as? String ?? ""
                // Parent row shows at a glance WHO the pane is (its custom 🗣 name,
                // or its label/tty) AND which 🔊 voice it uses (omitted when it just
                // follows the global voice). Naming a pane must not hide the voice —
                // surfacing the per-pane voice is what this list is for.
                let who = pname.isEmpty ? label : "🗣 \(pname)"
                let voiceTag = cur != nil ? " — 🔊 \(cur!)" : ""
                let item = NSMenuItem(title: who + voiceTag, action: nil, keyEquivalent: "")
                let sub = NSMenu()
                // Per-pane spoken name — opens a dialog (menu fields can't type).
                sub.addItem(disabledHeader("読み上げ名"))
                let nameItem = NSMenuItem(
                    title: pname.isEmpty ? "（クリックして設定…）" : "「\(pname)」を変更…",
                    action: #selector(promptPaneName(_:)), keyEquivalent: ""
                )
                nameItem.target = self
                nameItem.representedObject = [tty, pname]
                sub.addItem(nameItem)
                if !pname.isEmpty {
                    let clr = NSMenuItem(title: "読み上げ名を解除", action: #selector(runItem(_:)), keyEquivalent: "")
                    clr.target = self; clr.representedObject = ["name-pane", tty, "clear"]
                    sub.addItem(clr)
                }
                sub.addItem(.separator())
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
                // Per-pane 心理的安全性 (center = off; left スパルタ / right ホワイト).
                sub.addItem(disabledHeader("心理的安全性"))
                sub.addItem(paneLevelRow(value: (p["war"] as? Double) ?? 0.5, lo: 0, hi: 1, action: #selector(paneWarChanged(_:)), id: tty))
                let warDef = NSMenuItem(title: "強さを全体に従う", action: #selector(runItem(_:)), keyEquivalent: "")
                warDef.target = self; warDef.representedObject = ["war-pane", tty, "clear"]
                warDef.state = (p["warSet"] as? Bool ?? false) ? .off : .on
                sub.addItem(warDef)
                sub.addItem(.separator())
                // Per-pane 読み上げ prosody.
                sub.addItem(disabledHeader("読み上げ（速さ・高さ・抑揚）"))
                let pros = p["prosody"] as? [String: Any] ?? [:]
                for (key, lo, hi, dflt) in [("speed", 0.5, 1.5, 1.0), ("pitch", -0.15, 0.15, 0.0), ("intonation", 0.0, 1.5, 1.0)] {
                    let v = (pros[key] as? Double) ?? dflt
                    sub.addItem(paneLevelRow(value: v, lo: lo, hi: hi, action: #selector(paneProsodyChanged(_:)), id: "\(tty)\u{1}\(key)"))
                }
                let prosDef = NSMenuItem(title: "読み上げを全体に従う", action: #selector(runItem(_:)), keyEquivalent: "")
                prosDef.target = self; prosDef.representedObject = ["prosody-pane", tty, "clear"]
                prosDef.state = (p["prosodySet"] as? Bool ?? false) ? .off : .on
                sub.addItem(prosDef)
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
        // Waiting-for-input popup: enable + when-to-show settings, all in a submenu.
        let popupParent = NSMenuItem(title: "応答待ちポップアップ", action: nil, keyEquivalent: "")
        let popupSub = NSMenu()
        let onItem = NSMenuItem(title: "有効にする", action: #selector(runItem(_:)), keyEquivalent: "")
        onItem.target = self
        onItem.representedObject = ["popup", "toggle"]
        onItem.state = State.popupEnabled ? .on : .off
        popupSub.addItem(onItem)
        popupSub.addItem(.separator())
        // Threshold: only show after waiting this long.
        popupSub.addItem(disabledHeader("出すまでの待ち時間"))
        let curDelay = State.popupDelaySec
        for (sec, title) in [(0, "即時"), (5, "5秒"), (10, "10秒"), (15, "15秒"), (30, "30秒"), (60, "60秒")] {
            let it = NSMenuItem(title: title, action: #selector(runItem(_:)), keyEquivalent: "")
            it.target = self
            it.representedObject = ["popup", "delay", String(sec)]
            it.state = (curDelay == sec) ? .on : .off
            popupSub.addItem(it)
        }
        popupSub.addItem(.separator())
        // Reason filter + portrait sync.
        let ig = State.popupIgnoreRaw
        let ignoreItem = NSMenuItem(title: ig.isEmpty ? "無視ワードを設定…" : "無視ワード: \(ig)", action: #selector(promptPopupIgnore), keyEquivalent: "")
        ignoreItem.target = self
        popupSub.addItem(ignoreItem)
        let portItem = NSMenuItem(title: "ボイスの立ち絵を取得（VOICEVOX）", action: #selector(runItem(_:)), keyEquivalent: "")
        portItem.target = self
        portItem.representedObject = ["popup", "portraits"]
        popupSub.addItem(portItem)
        popupParent.submenu = popupSub
        menu.addItem(popupParent)

        // Which kinds of event actually alert (sound / banner / popup).
        let notifyParent = NSMenuItem(title: "通知する種類", action: nil, keyEquivalent: "")
        let notifySub = NSMenu()
        notifySub.addItem(disabledHeader("チェック＝音・バナーを出す"))
        for kind in State.notifyKinds() {
            let it = NSMenuItem(title: kind.label, action: #selector(runItem(_:)), keyEquivalent: "")
            it.target = self
            it.representedObject = ["notify", kind.key, "toggle"]
            it.state = kind.on ? .on : .off
            notifySub.addItem(it)
        }
        notifyParent.submenu = notifySub
        menu.addItem(notifyParent)

        menu.addItem(.separator())
        let settingsItem = NSMenuItem(title: "⚙ 設定（スライダー・数値・プリセット）…", action: #selector(openSettings), keyEquivalent: ",")
        settingsItem.target = self
        menu.addItem(settingsItem)

        menu.addItem(.separator())
        let quitItem = NSMenuItem(title: "ai-notify を終了", action: #selector(quit), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        return menu
    }

    private func showMenu() {
        let menu = buildMenu()
        if let button = statusItem.button {
            menu.popUp(positioning: nil, at: NSPoint(x: 0, y: button.bounds.height + 4), in: button)
        }
    }

    // Screenshot mode (env AI_NOTIFY_SHOT=/path): open the menu, capture just its
    // window via `screencapture`, then quit. Used to regenerate the README image
    // headlessly — never reached in normal operation.
    private var shotMenu: NSMenu?
    func captureMenuShot(_ path: String) {
        let menu = buildMenu()
        shotMenu = menu
        let pid = ProcessInfo.processInfo.processIdentifier
        // An open NSMenu runs the runloop in event-tracking mode, so the timer
        // must be registered in .common mode to fire while the menu is on screen.
        // The menu window can take a few ticks to register with the window
        // server, so poll for it rather than assuming a single fixed delay.
        var ticks = 0
        let t = Timer(timeInterval: 0.25, repeats: true) { [weak self] timer in
            ticks += 1
            let infos = (CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]]) ?? []
            var bestId: CGWindowID = 0
            var bestArea: CGFloat = 0
            for w in infos {
                guard (w[kCGWindowOwnerPID as String] as? pid_t) == pid else { continue }
                guard let b = w[kCGWindowBounds as String] as? [String: CGFloat],
                      let wd = b["Width"], let ht = b["Height"],
                      let num = w[kCGWindowNumber as String] as? Int else { continue }
                // The menu is far taller than the status-bar button window.
                let area = wd * ht
                if ht > 120 && area > bestArea { bestArea = area; bestId = CGWindowID(num) }
            }
            if bestId == 0 && ticks < 16 { return } // menu window not up yet — keep polling
            if bestId != 0 {
                // -l captures the window at native resolution and crops tight to
                // it; -o drops the drop-shadow for a clean asset.
                let p = Process()
                p.launchPath = "/usr/sbin/screencapture"
                p.arguments = ["-x", "-o", "-l", String(bestId), path]
                try? p.run(); p.waitUntilExit()
            }
            timer.invalidate()
            menu.cancelTracking()
            self?.shotMenu = nil
            NSApp.terminate(nil)
        }
        RunLoop.main.add(t, forMode: .common)
        NSApp.activate(ignoringOtherApps: true) // a popUp only shows for the active app
        if let button = statusItem.button {
            menu.popUp(positioning: nil, at: NSPoint(x: 0, y: button.bounds.height + 4), in: button)
        }
    }

    // Screenshot mode for the ⚙ settings window (AI_NOTIFY_SHOT_TARGET=settings):
    // open it, capture just its window via `screencapture`, then quit. Same headless
    // use as captureMenuShot — only ever reached when generating README assets.
    func captureSettingsShot(_ path: String) {
        settings.show()
        NSApp.activate(ignoringOtherApps: true)
        var ticks = 0
        let t = Timer(timeInterval: 0.25, repeats: true) { [weak self] timer in
            ticks += 1
            let id = self?.settings.windowNumber ?? 0
            if id == 0 && ticks < 16 { return } // window not registered yet — keep polling
            if id != 0 {
                let p = Process()
                p.launchPath = "/usr/sbin/screencapture"
                p.arguments = ["-x", "-o", "-l", String(id), path]
                try? p.run(); p.waitUntilExit()
            }
            timer.invalidate()
            NSApp.terminate(nil)
        }
        RunLoop.main.add(t, forMode: .common)
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
