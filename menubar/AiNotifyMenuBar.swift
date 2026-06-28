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
import AVFoundation

enum State {
    static func dir() -> String {
        let env = ProcessInfo.processInfo.environment
        let base = env["XDG_STATE_HOME"]
            ?? (NSHomeDirectory() as NSString).appendingPathComponent(".local/state")
        return (base as NSString).appendingPathComponent("ai-notify")
    }
    static func file(_ name: String) -> String { (dir() as NSString).appendingPathComponent(name) }

    // config.json lives in the CONFIG dir (XDG_CONFIG_HOME / ~/.config), NOT the
    // state dir — keep this separate from file()/json() which read state.
    static func configFile() -> String {
        let env = ProcessInfo.processInfo.environment
        let base = env["XDG_CONFIG_HOME"]
            ?? (NSHomeDirectory() as NSString).appendingPathComponent(".config")
        return ((base as NSString).appendingPathComponent("ai-notify") as NSString).appendingPathComponent("config.json")
    }

    // Speaker's language for voice input: "ja" (default) or "en". Drives whisper's
    // transcription language and prompt. Read fresh each time (cheap, tiny file).
    static var speakerLang: String {
        guard let d = try? Data(contentsOf: URL(fileURLWithPath: configFile())),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
              let l = o["speakerLang"] as? String, l == "en" || l == "ja" else { return "ja" }
        return l
    }

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

    // Volume at 0 is silence just like an explicit mute, so the menu bar icon and
    // the slider's speaker glyph treat it the same (slash mark / 🔇). The notify
    // path mirrors this (readVolume()===0 gates sound), so the mark stays truthful.
    static var isEffectivelyMuted: Bool { isMuted || volume <= 0 }

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

    // --- Voice input (音声操作) -------------------------------------------------
    // A flag file (same plain-file pattern as `muted`/`popup`) records whether the
    // mic wake-word loop should run, so the choice survives relaunches.
    static var voiceInputEnabled: Bool { FileManager.default.fileExists(atPath: file("voice-input")) }
    static func setVoiceInput(_ on: Bool) {
        let p = file("voice-input"), fm = FileManager.default
        if on { try? fm.createDirectory(atPath: dir(), withIntermediateDirectories: true); fm.createFile(atPath: p, contents: Data()) }
        else { try? fm.removeItem(atPath: p) }
    }

    // Show the floating "what I heard" caption. ON by default (the presence of a
    // `caption-off` flag file disables it) — it's the at-a-glance recognition
    // feedback for non-engineers who'd never tail the log.
    static var captionEnabled: Bool { !FileManager.default.fileExists(atPath: file("caption-off")) }
    static func setCaption(_ on: Bool) {
        let p = file("caption-off"), fm = FileManager.default
        if on { try? fm.removeItem(atPath: p) }
        else { try? fm.createDirectory(atPath: dir(), withIntermediateDirectories: true); fm.createFile(atPath: p, contents: Data()) }
    }

    // Push-to-talk: capture only while the talk key is held (no false triggers from
    // ambient speech / our own read-aloud). OFF by default (always-on VAD).
    static var pushToTalk: Bool { FileManager.default.fileExists(atPath: file("push-to-talk")) }
    static func setPushToTalk(_ on: Bool) {
        let p = file("push-to-talk"), fm = FileManager.default
        if on { try? fm.createDirectory(atPath: dir(), withIntermediateDirectories: true); fm.createFile(atPath: p, contents: Data()) }
        else { try? fm.removeItem(atPath: p) }
    }
    // The talk key's keyCode; default 63 = Fn (Mac-natural). ai-notify runs in the
    // background, so PTT uses a GLOBAL key monitor (needs Input Monitoring perm).
    static var pttKeyCode: Int {
        (try? String(contentsOfFile: file("ptt-keycode"), encoding: .utf8)).flatMap { Int($0.trimmingCharacters(in: .whitespacesAndNewlines)) } ?? 63
    }
    static func setPTTKeyCode(_ code: Int) {
        try? FileManager.default.createDirectory(atPath: dir(), withIntermediateDirectories: true)
        try? "\(code)".write(toFile: file("ptt-keycode"), atomically: true, encoding: .utf8)
    }
    // Live partial captions while speaking. ON by default (a `partial-off` flag disables).
    static var partialCaptions: Bool { !FileManager.default.fileExists(atPath: file("partial-off")) }
    static func setPartialCaptions(_ on: Bool) {
        let p = file("partial-off"), fm = FileManager.default
        if on { try? fm.removeItem(atPath: p) }
        else { try? fm.createDirectory(atPath: dir(), withIntermediateDirectories: true); fm.createFile(atPath: p, contents: Data()) }
    }

    // Normalize for loose name matching (mirror route.mjs norm: drop spaces +
    // punctuation, fold katakana→hiragana so ジョン==じょん, lowercase). Just enough
    // for a wake-word containment check.
    private static func normName(_ s: String) -> String {
        let drop = CharacterSet(charactersIn: " 　、。，．.,!！?？「」『』（）()・:：;；\n\t")
        let stripped = s.precomposedStringWithCompatibilityMapping // half-width kana → full
            .components(separatedBy: drop).joined()
            .decomposedStringWithCanonicalMapping // ジ → シ + ゛ so the mark can be dropped
        var out = ""
        for u in stripped.unicodeScalars {
            // Strip voicing marks so ポ=ボ=ホ, カ=ガ, シ=ジ all match — speech
            // recognition very often mis-voices a name ("ポール"→"ボール"). Mirrors
            // route.mjs norm()'s VOICING fold. Covers combining (3099/309A),
            // standalone (309B/309C), and half-width (FF9E/FF9F) marks.
            switch u.value {
            case 0x3099, 0x309A, 0x309B, 0x309C, 0xFF9E, 0xFF9F: continue
            default: break
            }
            // Katakana ァ(0x30A1)–ヶ(0x30F6) → hiragana by subtracting 0x60.
            if u.value >= 0x30A1 && u.value <= 0x30F6, let h = Unicode.Scalar(u.value - 0x60) {
                out.unicodeScalars.append(h)
            } else {
                out.unicodeScalars.append(u)
            }
        }
        return out.lowercased()
    }

    // Every pane's spoken name (speakName) and label — the wake words. A spoken
    // utterance only reaches `ai-notify reply` when it names one of these, so
    // ambient conversation never injects into an agent.
    static func knownPaneNames() -> [String] {
        var names: [String] = []
        for (_, v) in json("pane-voices.json") {
            guard let d = v as? [String: Any] else { continue }
            if let n = d["speakName"] as? String { names.append(n) }
            if let a = d["aliases"] as? [String] { names.append(contentsOf: a) } // extra readings (ポール/Paul)
        }
        for (_, v) in json("panes.json") {
            if let d = v as? [String: Any], let n = d["label"] as? String { names.append(n) }
        }
        return names.map(normName).filter { $0.count >= 2 }
    }

    // The pane names in their ORIGINAL form (not normalized) — fed to whisper as
    // an initial `--prompt` so it renders a spoken name as that exact string
    // ("ジョン" not "JON", "ポール" not "Paul") instead of romanizing it. Deduped,
    // order-preserving.
    static func paneNamesRaw() -> [String] {
        var names: [String] = []
        for (_, v) in json("pane-voices.json") {
            guard let d = v as? [String: Any] else { continue }
            if let n = d["speakName"] as? String, !n.isEmpty { names.append(n) }
            // Seed whisper with the aliases too (e.g. "Paul"), so it can render the
            // name in the exact form the speaker used instead of romanizing freely.
            if let a = d["aliases"] as? [String] { names.append(contentsOf: a.filter { !$0.isEmpty }) }
        }
        for (_, v) in json("panes.json") {
            if let d = v as? [String: Any], let n = d["label"] as? String, !n.isEmpty { names.append(n) }
        }
        var seen = Set<String>()
        return names.filter { seen.insert($0).inserted }
    }

    // The wake gate: only forward an utterance to `ai-notify reply` if it OPENS
    // with a wake word ("へい"/"hey"/…). route.mjs then does the (romaji-aware)
    // name match and decides. Gating on the wake word — not on a kana pane name —
    // means a name whisper ROMANIZED ("John" for ジョン, when an English command
    // follows) still gets through; the old name-containment check missed those.
    // Ambient speech and our own read-aloud rarely open with a wake word.
    static func utteranceAddressesPane(_ text: String) -> Bool {
        let n = normName(text)
        // "へい/えい/うぇい" = how whisper renders a spoken "Hey" (ヘイ/エイ/ウェイ by
        // pronunciation). Keep in sync with route.mjs WAKE.
        let wake = ["へい", "えい", "うぇい", "はい", "ねえ", "ねぇ", "おーい", "おい", "おっす", "hey", "ok"]
        return wake.contains { let w = normName($0); return !w.isEmpty && n.hasPrefix(w) }
    }

    // Append a timestamped line to <stateDir>/voice.log (capped) so the voice
    // path is debuggable without fighting the unified log. `tail -f` it.
    static func voiceLog(_ msg: String) {
        let path = file("voice.log")
        let line = "[\(ISO8601DateFormatter().string(from: Date()))] \(msg)\n"
        try? FileManager.default.createDirectory(atPath: dir(), withIntermediateDirectories: true)
        if let h = FileHandle(forWritingAtPath: path) {
            h.seekToEndOfFile(); h.write(line.data(using: .utf8) ?? Data()); try? h.close()
            // Trim if it grows past ~64 KB.
            if let size = try? FileManager.default.attributesOfItem(atPath: path)[.size] as? Int, size > 65536,
               let data = FileManager.default.contents(atPath: path) {
                try? data.suffix(32768).write(to: URL(fileURLWithPath: path))
            }
        } else {
            try? line.write(toFile: path, atomically: true, encoding: .utf8)
        }
    }

    @discardableResult
    static func cli(_ args: [String], capture: Bool = false) -> String? {
        let launcher = file("cli")
        guard FileManager.default.isExecutableFile(atPath: launcher) else { return nil }
        let task = Process()
        task.executableURL = URL(fileURLWithPath: launcher)
        task.arguments = args
        if !capture {
            do { try task.run() } catch { return nil }
            return nil
        }
        let outPipe = Pipe(), errPipe = Pipe()
        task.standardOutput = outPipe
        task.standardError = errPipe
        // Mark the pipe write-ends close-on-exec. Without this, a child spawned on
        // ANOTHER thread (whisper-server, via the warm-up) inherits these still-open
        // write fds and holds them open, so the read below never sees EOF and the
        // main thread deadlocks — which froze the whole app (no logs, no audio).
        fcntl(outPipe.fileHandleForWriting.fileDescriptor, F_SETFD, FD_CLOEXEC)
        fcntl(errPipe.fileHandleForWriting.fileDescriptor, F_SETFD, FD_CLOEXEC)
        do { try task.run() } catch { return nil }
        // Drop our own copies of the write-ends so EOF arrives when the child exits.
        try? outPipe.fileHandleForWriting.close()
        try? errPipe.fileHandleForWriting.close()
        // Read with a hard timeout: a stuck child must never hang the app.
        let fh = outPipe.fileHandleForReading
        var out = Data()
        let sem = DispatchSemaphore(value: 0)
        DispatchQueue.global(qos: .userInitiated).async { out = fh.readDataToEndOfFile(); sem.signal() }
        if sem.wait(timeout: .now() + 8) == .timedOut { task.terminate(); return nil }
        task.waitUntilExit()
        return String(data: out, encoding: .utf8)
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

// A slider whose TRACK is a left→right colour gradient, encoding the meaning of
// the two ends:
//   心理的安全性 : black (ブラック企業) → white (ホワイト企業)
//   ツンデレ      : 冷たい青 (ツン) → あたたかいピンク (デレ)
// The custom cell only repaints the BAR; the knob and all mouse tracking use the
// stock NSSliderCell behaviour, so dragging still updates the value. Built via
// cellClass (never swap .cell after init); the colours are set as properties.
final class GradientSliderCell: NSSliderCell {
    var startColor = NSColor(white: 0.12, alpha: 1) // left
    var endColor = NSColor(white: 0.97, alpha: 1) // right
    override func drawBar(inside rect: NSRect, flipped: Bool) {
        let h: CGFloat = 4
        let bar = NSRect(x: rect.minX, y: rect.midY - h / 2, width: rect.width, height: h)
        let radius = h / 2
        // Fill slider: only the FILLED portion (min → knob) shows the gradient; the
        // remainder (knob → max) is plain grey — like the stock sliders. So the
        // end colour (e.g. デレのピンク / ホワイトの白) only appears as the knob nears
        // that end, and an OFF/greyed slider is uniformly grey.
        let full = NSBezierPath(roundedRect: bar, xRadius: radius, yRadius: radius)
        NSColor(white: 0.5, alpha: 0.22).setFill()
        full.fill()

        let frac = maxValue > minValue ? CGFloat((doubleValue - minValue) / (maxValue - minValue)) : 0
        let fillW = max(0, min(bar.width, bar.width * frac))
        if fillW > 0.5 {
            NSGraphicsContext.saveGraphicsState()
            full.addClip() // keep the rounded ends
            NSBezierPath(rect: NSRect(x: bar.minX, y: bar.minY, width: fillW, height: bar.height)).addClip()
            if isEnabled {
                NSGradient(starting: startColor, ending: endColor)?.draw(in: bar, angle: 0) // full-bar gradient, clipped to the fill
            } else {
                NSColor(white: 0.55, alpha: 0.6).setFill() // OFF → flat grey fill
                bar.fill()
            }
            NSGraphicsContext.restoreGraphicsState()
        }
        NSColor(white: 0.5, alpha: 0.3).setStroke()
        full.lineWidth = 0.5
        full.stroke()
    }
}

final class GradientSlider: NSSlider {
    override class var cellClass: AnyClass? {
        get { GradientSliderCell.self }
        set {}
    }
}

// The two end colours for each skin's gradient track (left, right).
let TSUNDERE_GRADIENT = (NSColor(srgbRed: 0.27, green: 0.53, blue: 0.96, alpha: 1), // ツン: 冷たい青
                         NSColor(srgbRed: 1.0, green: 0.45, blue: 0.66, alpha: 1))  // デレ: あたたかいピンク
let PSAFETY_GRADIENT = (NSColor(white: 0.12, alpha: 1),  // ブラック企業: 黒
                        NSColor(white: 0.97, alpha: 1))  // ホワイト企業: 白
// 要約度: 左(MIN)=効果音のみ … 右(MAX)=全文読み上げ。短い→長いを淡→濃の緑で。
let SUMMARY_GRADIENT = (NSColor(srgbRed: 0.70, green: 0.86, blue: 0.74, alpha: 1), // MIN: 淡い緑
                        NSColor(srgbRed: 0.18, green: 0.60, blue: 0.33, alpha: 1)) // MAX: 濃い緑
// System accent blue. A plain NSSlider only paints its filled track in the accent
// color while its window is key; inside a menu (never key) it falls back to a dull
// grey. Setting `trackFillColor` paints it ourselves, so menu sliders stay blue
// regardless of focus — the same trick the settings window uses.
let ACCENT_BLUE = NSColor(srgbRed: 0, green: 122.0 / 255.0, blue: 1, alpha: 1)

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

// A transient floating caption that echoes what the mic just heard, so a NON-
// engineer can SEE their speech was recognized — no log tailing. Shows "聞いて
// います…" while capturing, then the transcript + outcome (sent / not-a-command /
// unclear), colour-coded, then fades out on its own. Click-through (never steals
// focus or blocks what's underneath).
final class CaptionWindow: NSObject {
    private let panel: NSPanel
    private let card = NSView()
    private let statusLabel = NSTextField(labelWithString: "")
    private let textLabel = NSTextField(wrappingLabelWithString: "")
    private var hideTimer: Timer?

    override init() {
        panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 440, height: 88),
                        styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        super.init()
        panel.isFloatingPanel = true
        panel.becomesKeyOnlyIfNeeded = true
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.level = .floating
        panel.hasShadow = true
        panel.ignoresMouseEvents = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]

        card.frame = NSRect(x: 0, y: 0, width: 440, height: 88)
        card.wantsLayer = true
        card.layer?.cornerRadius = 18
        card.layer?.backgroundColor = NSColor(calibratedWhite: 0.08, alpha: 0.92).cgColor
        card.layer?.borderWidth = 2

        statusLabel.frame = NSRect(x: 20, y: 52, width: 400, height: 24)
        statusLabel.font = .systemFont(ofSize: 16, weight: .bold)
        statusLabel.backgroundColor = .clear
        statusLabel.isBordered = false
        card.addSubview(statusLabel)

        textLabel.frame = NSRect(x: 20, y: 10, width: 400, height: 40)
        textLabel.font = .systemFont(ofSize: 18, weight: .semibold)
        textLabel.textColor = .white
        textLabel.maximumNumberOfLines = 2
        textLabel.backgroundColor = .clear
        textLabel.isBordered = false
        card.addSubview(textLabel)

        panel.contentView = card
    }

    private func position() {
        guard let screen = NSScreen.main else { return }
        let f = panel.frame
        panel.setFrameOrigin(NSPoint(x: screen.frame.midX - f.width / 2, y: screen.frame.minY + 130))
    }

    private func show(_ status: String, _ color: NSColor, text: String, seconds: TimeInterval) {
        statusLabel.stringValue = status
        statusLabel.textColor = color
        card.layer?.borderColor = color.withAlphaComponent(0.85).cgColor
        textLabel.stringValue = text
        textLabel.isHidden = text.isEmpty
        position()
        panel.alphaValue = 1
        panel.orderFrontRegardless()
        hideTimer?.invalidate()
        if seconds > 0 {
            hideTimer = Timer.scheduledTimer(withTimeInterval: seconds, repeats: false) { [weak self] _ in self?.fadeOut() }
        }
    }

    // Live "I'm hearing you" while the utterance is being captured.
    func listening() { show("🎙 聞いています…", .systemTeal, text: "", seconds: 0) }
    // Live interim transcript while the user is still speaking (no auto-hide).
    func partial(_ text: String) { show("🎙 認識中…", .systemTeal, text: "「\(text)…」", seconds: 0) }
    // Recognized AND delivered to a pane.
    func sent(_ who: String, _ heard: String) {
        show("✅ " + (who.isEmpty ? "送信しました" : "\(who) に送信"), .systemGreen, text: "「\(heard)」", seconds: 5)
    }
    // Recognized, but no wake word — just ambient/non-command speech.
    func heard(_ heard: String) { show("👂 聞こえました（指示ではありません）", NSColor(white: 0.8, alpha: 1), text: "「\(heard)」", seconds: 3) }
    // Addressed but the name/command wasn't understood.
    func unclear(_ heard: String) { show("🤔 もう一度（「ヘイ 名前、…」）", .systemOrange, text: heard.isEmpty ? "" : "「\(heard)」", seconds: 4) }
    // Recognized fine, but couldn't be delivered — show reply's own reason line
    // (🤔 the named pane has no live tmux pane, ⚠️ injection failed, …).
    func reason(_ line: String, _ heard: String) {
        let color: NSColor = line.hasPrefix("⚠️") ? .systemRed : .systemOrange
        show(line, color, text: heard.isEmpty ? "" : "「\(heard)」", seconds: 6)
    }

    private func fadeOut() {
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.4
            panel.animator().alphaValue = 0
        }, completionHandler: { [weak self] in self?.panel.orderOut(nil) })
    }

    func hide() { hideTimer?.invalidate(); panel.orderOut(nil) }
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
         fill: NSColor, colors: (NSColor, NSColor)? = nil, onToggle: (() -> Void)? = nil, onChange: @escaping (Double) -> Void) {
        self.lo = lo; self.hi = hi; self.onChange = onChange; self.onToggle = onToggle
        // colors => a meaning-coded gradient track (ツン青→デレピンク / ブラック黒→ホワイト白).
        // Built with its cell class from the start so dragging still tracks.
        slider = colors != nil
            ? GradientSlider(value: value, minValue: lo, maxValue: hi, target: nil, action: nil)
            : NSSlider(value: value, minValue: lo, maxValue: hi, target: nil, action: nil)
        super.init()
        if let (lo2, hi2) = colors, let cell = slider.cell as? GradientSliderCell {
            cell.startColor = lo2; cell.endColor = hi2
        }

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
            // 要約度: 0=効果音のみ・読み上げなし … 0.5=約10秒 … 1=全文読み上げ。
            SettingsRow(title: "要約度", asCheckbox: false, on: false, lo: 0, hi: 1, value: ((j["summary"] as? [String: Any])?["level"] as? Double) ?? 0.25, fill: blue, colors: SUMMARY_GRADIENT,
                        onChange: { State.cli(["summary", String(format: "%.2f", $0)]) }),
            // Reversed: field/knob left(0)=ツン … right(1)=デレ, while the file keeps 0=デレ…1=ツン.
            SettingsRow(title: "ツンデレ", asCheckbox: false, on: false, lo: 0, hi: 1, value: 1 - ((tsun?["level"] as? Double) ?? 0.5), fill: blue, colors: TSUNDERE_GRADIENT,
                        onChange: { State.cli(["tsundere", "level", String(format: "%.2f", 1 - $0)]) }),
            SettingsRow(title: "心理的安全性", asCheckbox: false, on: false, lo: 0, hi: 1, value: (warj?["level"] as? Double) ?? 0.5, fill: blue, colors: PSAFETY_GRADIENT,
                        onChange: { State.cli(["war", "level", String(format: "%.2f", $0)]) }),
            SettingsRow(title: "速さ", asCheckbox: false, on: false, lo: slo, hi: shi, value: (pr["speed"] as? Double) ?? 1, fill: blue,
                        onChange: { State.cli(["voice-prosody", "speed", String(format: "%.3f", $0)]) }),
            SettingsRow(title: "高さ", asCheckbox: false, on: false, lo: plo, hi: phi, value: (pr["pitch"] as? Double) ?? 0, fill: blue,
                        onChange: { State.cli(["voice-prosody", "pitch", String(format: "%.3f", $0)]) }),
            SettingsRow(title: "抑揚", asCheckbox: false, on: false, lo: ilo, hi: ihi, value: (pr["intonation"] as? Double) ?? 1, fill: blue,
                        onChange: { State.cli(["voice-prosody", "intonation", String(format: "%.3f", $0)]) }),
        ]
        var y = 264
        let header = NSTextField(labelWithString: "中央=OFF。ツンデレ=左ツン⇔右デレ　心理的安全性=左ブラック企業⇔右ホワイト企業")
        header.frame = NSRect(x: 16, y: 286, width: 440, height: 16)
        header.font = .systemFont(ofSize: 11); header.textColor = .secondaryLabelColor
        content.addSubview(header)
        for r in rows {
            r.view.frame.origin = NSPoint(x: 0, y: CGFloat(y))
            content.addSubview(r.view)
            self.rows.append(r) // retain
            y -= 36
        }

        // Voice-input section: a plain on/off checkbox for the floating recognition
        // caption (the at-a-glance "what I heard" overlay for non-engineers).
        let vsep = NSBox(frame: NSRect(x: 12, y: 44, width: 446, height: 1)); vsep.boxType = .separator; content.addSubview(vsep)
        let capCb = NSButton(checkboxWithTitle: "🎙 認識した言葉を画面に字幕で表示する", target: self, action: #selector(toggleCaptionSetting(_:)))
        capCb.frame = NSRect(x: 16, y: 14, width: 440, height: 22)
        capCb.state = State.captionEnabled ? .on : .off
        content.addSubview(capCb)

        w.contentView = content
    }

    @objc private func toggleCaptionSetting(_ sender: NSButton) {
        State.setCaption(sender.state == .on)
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

// Always-listening voice input, powered by whisper.cpp (Homebrew `whisper-cli`).
// We capture each utterance ourselves — AVAudioEngine tap → downsample to 16 kHz
// mono → energy-based voice-activity detection — and, on a ~1s trailing pause,
// hand the audio to whisper's large-v3-turbo model. It is far better at Japanese
// AND embedded English ("git status") than the ja-JP on-device SFSpeechRecognizer
// it replaces, and needs no macOS Dictation — only the mic. The decoded text runs
// through the SAME wake gate + `ai-notify reply` path: when it addresses a pane
// ("ずんだもんアルファ、Aを実行"), the whole utterance is injected via tmux.
final class VoiceListener: NSObject {
    private var engine = AVAudioEngine() // recreated on a device change (see restartEngine)
    private var converter: AVAudioConverter?
    private let outFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false)!
    private let work = DispatchQueue(label: "ai-notify.whisper", qos: .userInitiated)
    private var running = false
    private var tapInstalled = false
    private var generation = 0 // bumped on disable; a late transcription with a stale gen is dropped
    private var loggedAudioOnce = false

    // UI feedback hooks (set by AppDelegate) — drive the floating caption. Always
    // invoked on the main thread. onListening: an utterance just started capturing.
    // onResult(kind, who, heard): kind ∈ "sent" | "heard" | "unclear".
    var onListening: (() -> Void)?
    var onResult: ((String, String, String) -> Void)?
    var onPartial: ((String) -> Void)?   // interim transcript while still speaking

    // Push-to-talk. `pushToTalk` gates capture on `talkActive` (the talk key, set
    // from the app on the main thread). Bool read/write is atomic enough here.
    var pushToTalk = false
    private var talkActive = false
    func setPushToTalk(_ on: Bool) { pushToTalk = on }
    func setTalkActive(_ on: Bool) { talkActive = on }

    // Live partial captions: re-transcribe the growing utterance periodically.
    private var lastPartialSample = 0
    private var partialInFlight = false
    private var lastPartialText = ""
    private let partialInterval = 12000   // ~0.75s of new audio between interim decodes
    private let partialMinVoiced = 12800  // ~0.8s voiced before the first interim

    // Self-healing. AVAudioEngine silently STOPS on an I/O configuration change —
    // an output device swap (AirPods), a sample-rate change, sleep/wake, or the
    // mic being grabbed by another app — and never resumes on its own, so the tap
    // goes dead and the listener is deaf forever though the app stays alive (the
    // "nothing gets logged anymore" bug). We recover two ways: (a) observe the
    // config-change notification, and (b) a watchdog that restarts the engine if
    // no audio buffer has arrived recently — catching the modes that post no note.
    private var lastBufferAt: Double = 0   // epoch seconds of the last tap buffer
    private var watchdog: Timer?
    private var observingConfig = false

    // VAD state — touched only on the audio (tap) thread, so no locking needed.
    private var capturing = false
    private var captured: [Float] = []
    private var preRoll: [Float] = []
    private var voicedSamples = 0
    private var silentSamples = 0
    private var uttPeak: Float = 0      // loudest frame in the current utterance (relative-endpoint ref)
    private var noiseFloor: Float = 0.005
    private var dbgPeak: Float = 0   // loudest frame since the last level log
    private var dbgCount = 0

    // Durations as 16 kHz sample counts.
    private let preRollMax = 4800       // 0.3s kept before onset so the first mora isn't clipped
    private let endpointSilence = 14400 // 0.9s of quiet ends the utterance (rides over mid-phrase pauses)
    private let maxUtterance = 192000   // 12s hard cap (bounds worst-case log/transcribe lag)
    private let minVoiced = 4000        // < ~0.25s of voiced audio → noise, dropped

    private lazy var serverBin: String = {
        ["/opt/homebrew/bin/whisper-server", "/usr/local/bin/whisper-server"]
            .first { FileManager.default.isExecutableFile(atPath: $0) } ?? "whisper-server"
    }()
    private let modelPath = State.file("whisper/ggml-large-v3-turbo-q5_0.bin")
    // A persistent whisper-server keeps the model resident in RAM, so each
    // utterance costs only inference (~0.3s) instead of a fresh ~1s model load.
    private let port = 8917
    private var serverProc: Process?

    // Verify whisper + model are present, ask for mic permission, then start.
    func enable(_ completion: @escaping (Bool, String) -> Void) {
        State.voiceLog("enable() called; micStatus=\(AVCaptureDevice.authorizationStatus(for: .audio).rawValue)")
        guard FileManager.default.isExecutableFile(atPath: serverBin) else {
            completion(false, "whisper-server が見つかりません（brew install whisper-cpp）"); return
        }
        guard FileManager.default.fileExists(atPath: modelPath) else {
            completion(false, "音声モデルがありません: \(modelPath)"); return
        }
        pushToTalk = State.pushToTalk
        talkActive = false
        requestMic { granted in
            State.voiceLog("mic granted: \(granted)")
            guard granted else { completion(false, "マイクの許可が必要です（システム設定 › プライバシー）"); return }
            do {
                try self.start()
                // Warm up the model server now so the first utterance is fast.
                self.work.async { _ = self.ensureServerReady() }
                State.voiceLog("listening (whisper-server: \((self.modelPath as NSString).lastPathComponent))")
                completion(true, "🎙️ 音声操作 ON")
            } catch {
                State.voiceLog("start FAILED: \(error.localizedDescription)")
                completion(false, "マイクの開始に失敗: \(error.localizedDescription)")
            }
        }
    }

    private func requestMic(_ cb: @escaping (Bool) -> Void) {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: cb(true)
        case .notDetermined: AVCaptureDevice.requestAccess(for: .audio) { ok in DispatchQueue.main.async { cb(ok) } }
        default: cb(false)
        }
    }

    private func start() throws {
        let input = engine.inputNode
        let inFormat = input.outputFormat(forBus: 0)
        if !loggedAudioOnce { State.voiceLog("input format: \(inFormat.sampleRate)Hz ch=\(inFormat.channelCount)") }
        // During a device transition (AirPods connecting, sleep/wake) the input
        // format is briefly invalid (0 Hz / 0 ch). installTap() with such a format
        // raises an NSException — which Swift can't catch, so it ABORTS the whole
        // app (the AirPods crash). Refuse to install until the format is sane; the
        // watchdog retries shortly, by when the new device has settled.
        guard inFormat.sampleRate > 0, inFormat.channelCount > 0 else {
            throw NSError(domain: "ai-notify", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "input not ready (\(inFormat.sampleRate)Hz ch=\(inFormat.channelCount))"])
        }
        converter = AVAudioConverter(from: inFormat, to: outFormat)
        if !tapInstalled {
            // installTap RAISES an NSException (uncatchable by Swift) when the
            // format doesn't match the input device mid-transition. ainTry turns
            // that into a value so we fail cleanly and the watchdog retries once
            // the device has settled — instead of aborting the app.
            if let ex = ainTry({
                input.installTap(onBus: 0, bufferSize: 2048, format: inFormat) { [weak self] buf, _ in
                    self?.feed(buf)
                }
            }) {
                throw NSError(domain: "ai-notify", code: 2,
                              userInfo: [NSLocalizedDescriptionKey: "installTap: \(ex.reason ?? "NSException")"])
            }
            tapInstalled = true
        }
        engine.prepare()
        try engine.start()
        running = true
        lastBufferAt = Date().timeIntervalSince1970
        installRecovery()
    }

    // Arm the config-change observer + the no-audio watchdog (both idempotent).
    private func installRecovery() {
        if !observingConfig {
            observingConfig = true
            NotificationCenter.default.addObserver(
                self, selector: #selector(audioConfigChanged),
                name: .AVAudioEngineConfigurationChange, object: engine)
        }
        if watchdog == nil {
            // Buffers arrive ~20×/sec while alive (even silence/while muted), so a
            // multi-second gap means the tap is dead. Checked on the main runloop.
            watchdog = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
                guard let self = self, self.running else { return }
                let gap = Date().timeIntervalSince1970 - self.lastBufferAt
                if gap > 4 { self.scheduleRestart(0.0, reason: String(format: "watchdog: no audio for %.1fs", gap)) }
            }
        }
    }

    @objc private func audioConfigChanged(_ note: Notification) {
        // Restart on main, but DELAYED: at the instant a device changes (AirPods
        // connecting) the input format is briefly invalid, and re-reading it now
        // would feed installTap() a bad format → NSException → abort. Waiting lets
        // the new device settle. scheduleRestart coalesces the burst of changes.
        DispatchQueue.main.async { [weak self] in
            self?.scheduleRestart(0.4, reason: "audio config changed")
        }
    }

    // Debounced engine restart: collapses a burst of config-change events into one
    // restart and delays it so the audio device has settled before we re-read the
    // format. A failed restart (still settling) is retried by the watchdog.
    private var restartPending = false
    private func scheduleRestart(_ delay: Double, reason: String) {
        guard running, !restartPending else { return }
        restartPending = true
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self = self else { return }
            self.restartPending = false
            guard self.running else { return }
            State.voiceLog("\(reason) → restarting engine")
            self.restartEngine()
        }
    }

    // Rebuild the engine + tap after a configuration change. CRUCIAL: create a
    // FRESH AVAudioEngine. The old inputNode keeps reporting the PREVIOUS device's
    // format (e.g. 96 kHz from the MacBook mic) even after stop()/start(), so
    // installTap against the new device (AirPods, ~24 kHz) fails "format mismatch"
    // forever — the watchdog loop you saw. A new engine reads the CURRENT hardware
    // format cleanly. installTap is still wrapped in ainTry, so a mid-transition
    // attempt fails cleanly and the watchdog retries rather than aborting.
    private func restartEngine() {
        guard running else { return }
        if observingConfig {
            NotificationCenter.default.removeObserver(self, name: .AVAudioEngineConfigurationChange, object: engine)
            observingConfig = false // re-armed on the new engine by start() → installRecovery()
        }
        if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
        if engine.isRunning { engine.stop() }
        engine = AVAudioEngine()
        converter = nil
        capturing = false; captured = []; preRoll = []; voicedSamples = 0; silentSamples = 0
        do {
            try start()
            State.voiceLog("engine restarted")
        } catch {
            lastBufferAt = Date().timeIntervalSince1970 // grace; the watchdog retries
            State.voiceLog("engine restart failed: \(error.localizedDescription) — will retry")
        }
    }

    // While ai-notify is reading something aloud (it writes a "mute until" epoch-ms
    // to mic-mute-until), drop ALL mic audio so whisper never transcribes our own
    // speech / the agents' spoken replies. Re-read the file at most ~5×/sec.
    private var muteUntilMs: Double = 0
    private var muteCheckedAt: Double = 0
    private var wasMuted = false
    private func micMuted() -> Bool {
        let now = Date().timeIntervalSince1970 * 1000
        if now - muteCheckedAt > 200 {
            muteCheckedAt = now
            if let s = try? String(contentsOfFile: State.file("mic-mute-until"), encoding: .utf8),
               let u = Double(s.trimmingCharacters(in: .whitespacesAndNewlines)) {
                muteUntilMs = u
            } else { muteUntilMs = 0 }
        }
        let muted = now < muteUntilMs
        if muted != wasMuted { wasMuted = muted; State.voiceLog(muted ? "mic muted (ai-notify speaking)" : "mic unmuted") }
        return muted
    }

    // Downsample one input buffer to 16 kHz mono Float32, then drive the VAD.
    private func feed(_ buf: AVAudioPCMBuffer) {
        lastBufferAt = Date().timeIntervalSince1970 // proof the tap is alive (even while muted)
        guard let converter = converter else { return }
        if micMuted() {
            // Discard audio AND any half-captured utterance so our read-aloud can't
            // start or finish a capture; keep the noise floor from drifting on it.
            if capturing { capturing = false; captured = []; voicedSamples = 0; silentSamples = 0; uttPeak = 0 }
            if !preRoll.isEmpty { preRoll.removeAll() }
            return
        }
        // Push-to-talk gate: while the talk key is up, drop audio. If we were mid-
        // utterance (key just released), finalize and transcribe what we captured.
        if pushToTalk && !talkActive {
            if capturing { finalizeCurrentUtterance() }
            if !preRoll.isEmpty { preRoll.removeAll() }
            return
        }
        let ratio = outFormat.sampleRate / buf.format.sampleRate
        let cap = AVAudioFrameCount(Double(buf.frameLength) * ratio + 32)
        guard let out = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: cap) else { return }
        var fed = false
        var err: NSError?
        converter.convert(to: out, error: &err) { _, status in
            if fed { status.pointee = .noDataNow; return nil }
            fed = true; status.pointee = .haveData; return buf
        }
        if err != nil { return }
        let n = Int(out.frameLength)
        guard n > 0, let ch = out.floatChannelData?[0] else { return }
        if !loggedAudioOnce { State.voiceLog("first audio buffer: 16k frames=\(n)"); loggedAudioOnce = true }
        var frame = [Float](repeating: 0, count: n)
        var sum: Float = 0
        for i in 0..<n { let v = ch[i]; frame[i] = v; sum += v * v }
        process(frame, rms: (sum / Float(n)).squareRoot())
    }

    // Energy-VAD: collect samples from speech onset until a trailing pause, then
    // hand the utterance off. An adaptive noise floor (updated only while idle)
    // keeps it working across quiet rooms and noisy ones.
    private func process(_ frame: [Float], rms: Float) {
        let onset = max(0.010, noiseFloor * 2.8)
        let release = max(0.005, noiseFloor * 1.4)
        // Diagnostic: every ~3s of audio, log the loudest frame seen vs the onset
        // level, so mic-too-quiet vs threshold-too-high is visible in voice.log.
        dbgPeak = max(dbgPeak, rms); dbgCount += 1
        if dbgCount >= 200 { // ~20s heartbeat (was every 3s — too noisy now tuning's done)
            State.voiceLog(String(format: "level: peak=%.4f noiseFloor=%.4f onset=%.4f capturing=%@",
                                  dbgPeak, noiseFloor, onset, capturing ? "yes" : "no"))
            dbgPeak = 0; dbgCount = 0
        }
        if !capturing {
            // Adapt the noise floor ONLY on genuinely quiet frames — otherwise
            // speech inflates it and drags `onset` up above the very speech that
            // should trigger it (a self-defeating feedback loop). Capped low.
            if rms < 0.012 { noiseFloor = min(0.015, 0.96 * noiseFloor + 0.04 * rms) }
            preRoll.append(contentsOf: frame)
            if preRoll.count > preRollMax { preRoll.removeFirst(preRoll.count - preRollMax) }
            if rms > onset {
                capturing = true
                captured = preRoll
                voicedSamples = frame.count
                silentSamples = 0
                uttPeak = rms
                lastPartialSample = 0
                lastPartialText = ""
                DispatchQueue.main.async { [weak self] in self?.onListening?() } // "🎙 聞いています…"
            }
        } else {
            captured.append(contentsOf: frame)
            // Relative endpoint: "silent" is judged against THIS utterance's own
            // speech level, not just the absolute floor. A fixed `release` can sit
            // below the room's ambient (e.g. AirPods self-noise drives noiseFloor to
            // ~0.001 so release pins to its 0.005 floor) — then trailing ambient never
            // reads as silent and every utterance runs to the maxUtterance cap (the
            // "20s lag" bug). Gating on a fraction of the speech peak auto-scales to
            // any mic/room: after speech at ~0.08, a 0.006 ambient tail counts as quiet.
            uttPeak = max(uttPeak, rms)
            let endThresh = max(release, uttPeak * 0.18)
            if rms > endThresh { voicedSamples += frame.count; silentSamples = 0 }
            else { silentSamples += frame.count }
            maybeEmitPartial()
            // In push-to-talk, only the key release (or the hard cap) ends the
            // utterance — a mid-sentence pause shouldn't cut it off.
            let silenceEnded = !pushToTalk && silentSamples >= endpointSilence
            if silenceEnded || captured.count >= maxUtterance {
                finalizeCurrentUtterance()
            }
        }
    }

    // Snapshot the utterance and hand it to transcription, resetting VAD state.
    private func finalizeCurrentUtterance() {
        guard capturing else { return }
        let utt = captured
        let voiced = voicedSamples
        capturing = false; captured = []; preRoll = []
        voicedSamples = 0; silentSamples = 0; uttPeak = 0; lastPartialSample = 0; lastPartialText = ""
        if voiced >= minVoiced { transcribe(utt) }
    }

    // Every ~0.75s of fresh speech, kick off a non-blocking interim transcription of
    // the audio captured so far so the caption updates live. One at a time; deduped.
    private func maybeEmitPartial() {
        guard State.partialCaptions, !partialInFlight,
              voicedSamples >= partialMinVoiced,
              captured.count - lastPartialSample >= partialInterval else { return }
        lastPartialSample = captured.count
        partialInFlight = true
        let snapshot = captured
        let gen = generation
        work.async { [weak self] in
            guard let self = self else { return }
            defer { self.partialInFlight = false }
            guard self.ensureServerReady() else { return }
            let text = self.serverTranscribe(self.wavData(snapshot))?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard !text.isEmpty, text != self.lastPartialText else { return }
            self.lastPartialText = text
            DispatchQueue.main.async {
                guard self.running, self.generation == gen, self.capturing else { return }
                self.onPartial?(text)
            }
        }
    }

    // Off the audio thread: WAV-encode the utterance, POST it to whisper-server,
    // gate + reply. Serialized on `work`, so server start-up and requests can't race.
    private func transcribe(_ samples: [Float]) {
        let gen = generation
        State.voiceLog(String(format: "utterance captured: %.1fs → transcribing", Double(samples.count) / 16000.0))
        work.async { [weak self] in
            guard let self = self else { return }
            guard self.ensureServerReady() else { State.voiceLog("whisper-server unavailable"); return }
            guard let text = self.serverTranscribe(self.wavData(samples))?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !text.isEmpty else { State.voiceLog("whisper: (no speech)"); return }
            DispatchQueue.main.async {
                guard self.running, self.generation == gen else { return }
                self.handle(text)
            }
        }
    }

    // POST the WAV to the local whisper-server. Per-request `language` + `prompt`
    // (the EXACT pane names) keep names as kana — "ジョン" not "JON" — while a
    // clearly-English command word ("git status") still stays latin.
    private func serverTranscribe(_ wav: Data) -> String? {
        var body = Data()
        let boundary = "----ainotify-boundary"
        func field(_ name: String, _ value: String) {
            body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".data(using: .utf8)!)
        }
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.wav\"\r\nContent-Type: audio/wav\r\n\r\n".data(using: .utf8)!)
        body.append(wav); body.append("\r\n".data(using: .utf8)!)
        let lang = State.speakerLang // "ja" | "en"
        field("language", lang)
        field("response_format", "text")
        // Bias decoding toward the EXACT pane names so they aren't romanized
        // ("ジョン"→"JON"). For a Japanese speaker also seed common command verbs;
        // for English, names only (the JP vocab would just confuse an EN model).
        let names = State.paneNamesRaw()
        if !names.isEmpty {
            let prompt = lang == "ja"
                ? names.joined(separator: "、") + "。git status、PR作成、コミット、テスト実行、許可、却下。"
                : names.joined(separator: ", ") + "."
            field("prompt", prompt)
        }
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)

        var req = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/inference")!)
        req.httpMethod = "POST"
        req.timeoutInterval = 30
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.httpBody = body

        var result: String?
        let sem = DispatchSemaphore(value: 0)
        URLSession.shared.dataTask(with: req) { data, _, err in
            if let err = err { State.voiceLog("server request error: \(err.localizedDescription)") }
            if let data = data { result = String(data: data, encoding: .utf8) }
            sem.signal()
        }.resume()
        _ = sem.wait(timeout: .now() + 31)
        // Strip whisper's bracketed non-speech tokens ([BLANK_AUDIO], (笑)), then
        // drop the whole utterance if what's left is a known silence hallucination
        // — returning "" makes the caller log "(no speech)" and reply nothing.
        let cleaned = (result ?? "")
            .replacingOccurrences(of: "\\[[^\\]]*\\]", with: "", options: .regularExpression)
            .replacingOccurrences(of: "\\([^)]*\\)", with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if Self.isHallucination(cleaned) {
            if !cleaned.isEmpty { State.voiceLog("dropped hallucination: \"\(cleaned)\"") }
            return ""
        }
        return cleaned
    }

    // whisper's large-v3 family fills near-silence / noise with a few stock
    // phrases from its training data — overwhelmingly the YouTube outro "ご視聴
    // ありがとうございました" and its kin (channel-subscribe nags, "ご清聴…"). None is
    // ever a voice command, so an utterance carrying one of these tell-tale stems
    // is noise: drop it. Matched on a stem (not the whole string) to ride over
    // whisper's punctuation/spacing variants. Deliberately conservative — bare
    // "ありがとう" or "はい" stay (the latter is a wake word), so real speech survives.
    private static let hallucinationStems = ["ご視聴", "ご清聴", "ご覧いただき", "チャンネル登録", "高評価"]
    static func isHallucination(_ text: String) -> Bool {
        text.isEmpty || hallucinationStems.contains { text.contains($0) }
    }

    // Spawn whisper-server (if not already up) and wait until it answers. Reuses a
    // server already listening on the port — including one left from a prior run —
    // so re-enabling voice is instant. Always called on the `work` queue.
    private func ensureServerReady() -> Bool {
        if serverReachable() { return true }
        if !(serverProc?.isRunning ?? false) {
            let p = Process()
            p.executableURL = URL(fileURLWithPath: serverBin)
            // -nf: no temperature fallback — keep decoding at temp 0 so a failed
            // decode stays failed instead of retrying hot and emitting a confident
            // hallucination. -sns: suppress non-speech tokens. Both blunt the
            // "ご視聴…" noise output at the source (the text denylist is the backstop).
            p.arguments = ["-m", modelPath, "-l", "ja", "-t", "8", "-nf", "-sns", "--host", "127.0.0.1", "--port", "\(port)"]
            p.standardOutput = Pipe(); p.standardError = Pipe()
            do { try p.run(); serverProc = p; State.voiceLog("whisper-server starting…") }
            catch { State.voiceLog("server spawn failed: \(error.localizedDescription)"); return false }
        }
        for _ in 0..<40 { // up to ~20s for the model to load
            if serverReachable() { State.voiceLog("whisper-server ready"); return true }
            Thread.sleep(forTimeInterval: 0.5)
        }
        return false
    }

    private func serverReachable() -> Bool {
        var req = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/")!)
        req.timeoutInterval = 1.0
        var ok = false
        let sem = DispatchSemaphore(value: 0)
        URLSession.shared.dataTask(with: req) { _, resp, err in ok = (err == nil && resp != nil); sem.signal() }.resume()
        _ = sem.wait(timeout: .now() + 2)
        return ok
    }

    // Minimal 16 kHz mono 16-bit PCM WAV in memory. Quiet utterances are gained up
    // to a healthy peak first (this mic is low-gain), since whisper transcribes a
    // normalized signal more accurately. Amplify only, capped, skip near-silence.
    private func wavData(_ samples: [Float]) -> Data {
        var peak: Float = 0
        for f in samples { peak = max(peak, abs(f)) }
        let gain: Float = (peak > 0.003 && peak < 0.5) ? min(0.5 / peak, 15.0) : 1.0
        let sr: UInt32 = 16000
        let dataSize = UInt32(samples.count * 2)
        var d = Data(capacity: Int(dataSize) + 44)
        func u32(_ v: UInt32) { d.append(UInt8(v & 0xff)); d.append(UInt8((v >> 8) & 0xff)); d.append(UInt8((v >> 16) & 0xff)); d.append(UInt8((v >> 24) & 0xff)) }
        func u16(_ v: UInt16) { d.append(UInt8(v & 0xff)); d.append(UInt8((v >> 8) & 0xff)) }
        d.append(contentsOf: Array("RIFF".utf8)); u32(36 + dataSize); d.append(contentsOf: Array("WAVE".utf8))
        d.append(contentsOf: Array("fmt ".utf8)); u32(16); u16(1); u16(1); u32(sr); u32(sr * 2); u16(2); u16(16)
        d.append(contentsOf: Array("data".utf8)); u32(dataSize)
        for f in samples { u16(UInt16(bitPattern: Int16(max(-1, min(1, f * gain)) * 32767))) }
        return d
    }

    func disable() {
        running = false
        generation &+= 1
        watchdog?.invalidate(); watchdog = nil
        if observingConfig {
            NotificationCenter.default.removeObserver(self, name: .AVAudioEngineConfigurationChange, object: engine)
            observingConfig = false
        }
        if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
        if engine.isRunning { engine.stop() }
        capturing = false; captured = []; preRoll = []
        // Free the model's RAM when voice is turned off; re-enable respawns it.
        serverProc?.terminate(); serverProc = nil
    }

    // A finalized utterance: forward it to `ai-notify reply` only if it names a
    // pane, and chirp on a successful injection.
    private func handle(_ text: String) {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        let addressed = State.utteranceAddressesPane(t)
        State.voiceLog("heard: \"\(t)\"  addressed=\(addressed ? "yes" : "no")")
        guard addressed else { onResult?("heard", "", t); return } // 👂 caption only
        let out = (State.cli(["reply", t], capture: true) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        State.voiceLog("reply: \(out)")
        if out.hasPrefix("✅") {
            NSSound(named: "Tink")?.play()
            onResult?("sent", Self.replyName(out), t)
        } else if !out.isEmpty {
            // reply explained WHY it couldn't run (🤔 pane offline / command not
            // understood, ⚠️ inject failed). Surface that exact reason instead of a
            // generic "say it again" — otherwise a recognized command looks ignored.
            onResult?("reason", out, t)
        } else {
            onResult?("unclear", "", t)
        }
    }

    // Pull the pane name out of a reply line: "✅ ジョン (%4) → 「…」を入力" → "ジョン".
    private static func replyName(_ out: String) -> String {
        var s = out
        if s.hasPrefix("✅") { s.removeFirst() }
        s = s.trimmingCharacters(in: .whitespaces)
        for sep in [" (", " →", "("] {
            if let r = s.range(of: sep) { return String(s[..<r.lowerBound]).trimmingCharacters(in: .whitespaces) }
        }
        return s
    }
}
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var timer: Timer?
    private let settings = SettingsWindowController()
    private let voice = VoiceListener()
    private let caption = CaptionWindow()
    private var pttMonitor: Any?

    // Selectable PTT keys (modifiers that type nothing). Fn is default.
    static let pttKeyOptions: [(code: Int, name: String, flag: NSEvent.ModifierFlags)] = [
        (63, "Fn", .function), (61, "右Option", .option), (58, "左Option", .option),
        (54, "右Command", .command), (59, "Control", .control),
    ]
    private func pttFlag(_ code: Int) -> NSEvent.ModifierFlags {
        Self.pttKeyOptions.first { $0.code == code }?.flag ?? .function
    }
    // ai-notify runs in the background, so PTT needs a GLOBAL monitor — which
    // requires Input Monitoring permission (システム設定›プライバシー›入力監視).
    private func installPTTMonitor() {
        guard pttMonitor == nil else { return }
        pttMonitor = NSEvent.addGlobalMonitorForEvents(matching: .flagsChanged) { [weak self] event in
            guard let self = self, State.pushToTalk, Int(event.keyCode) == State.pttKeyCode else { return }
            let down = event.modifierFlags.contains(self.pttFlag(State.pttKeyCode))
            self.voice.setTalkActive(down)
            if down && State.captionEnabled { self.caption.listening() }
        }
    }
    private func removePTTMonitor() {
        if let m = pttMonitor { NSEvent.removeMonitor(m); pttMonitor = nil }
        voice.setTalkActive(false)
    }

    // The "waiting for input" popup — one floating card per waiting pane.
    private var waitingCards: [String: PopupCard] = [:] // keyed by tty
    private var dismissedTtys: Set<String> = []          // clicked away; reshow on the next wait

    // Live refs to the skin sliders + their labels, so flipping a toggle SWITCH
    // can enable/grey its slider in place (the menu doesn't rebuild while open).
    private weak var tsundereSlider: NSSlider?
    private weak var tsundereCap: NSTextField?
    private weak var psafetySlider: NSSlider?
    private weak var psafetyCap: NSTextField?
    // Live ref to the global volume row's speaker icon, so unmuting by dragging
    // the slider flips 🔇 → 🔊 in place without rebuilding the (open) menu.
    private weak var globalVolumeIcon: NSTextField?

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let b = statusItem.button {
            b.action = #selector(handleClick(_:))
            b.target = self
            b.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }
        // Reap ghost panes / orphaned "waiting" entries left on disk by dead
        // ttys (e.g. after a reboot) BEFORE the first render reads them, so we
        // never flash stale panes or a stuck "waiting for input" popup.
        State.cli(["reap"], capture: true)
        render()
        timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.render()
            self?.updateWaitingPopup()
        }
        // Floating recognition caption: echo what the mic heard so a non-engineer
        // can SEE it's working (no log tailing). Gated by the menu toggle.
        voice.onListening = { [weak self] in if State.captionEnabled { self?.caption.listening() } }
        voice.onResult = { [weak self] kind, who, heard in
            guard State.captionEnabled else { return }
            switch kind {
            case "sent": self?.caption.sent(who, heard)
            case "reason": self?.caption.reason(who, heard) // `who` carries reply's reason line
            case "unclear": self?.caption.unclear(heard)
            default: self?.caption.heard(heard)
            }
        }
        voice.onPartial = { [weak self] text in if State.captionEnabled { self?.caption.partial(text) } }
        voice.setPushToTalk(State.pushToTalk)
        if State.pushToTalk { installPTTMonitor() }
        // Resume the mic wake-word loop if it was left on (clear the flag if the
        // permission was since revoked, so the menu reflects reality).
        State.voiceLog("didFinishLaunching; voiceInputEnabled=\(State.voiceInputEnabled)")
        if State.voiceInputEnabled {
            voice.enable { ok, msg in State.voiceLog("enable completion: ok=\(ok) msg=\(msg)"); if !ok { State.setVoiceInput(false) } }
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

    // The ai-notify mark: a terminal prompt "›" + a 3-bar voice waveform ("the
    // terminal speaks up"). Drawn in the 32×32 viewBox of assets/logo.svg so the
    // menu bar icon and the README logo are the SAME shape. Stroke + fill use the
    // current color (black for a template image; the system tints it).
    private func drawMark(in rect: NSRect) {
        let s = min(rect.width / 32.0, rect.height / 32.0)
        let ox = rect.minX + (rect.width - 32 * s) / 2
        let oy = rect.minY + (rect.height - 32 * s) / 2
        // SVG y is top-down; AppKit is bottom-up — flip with (32 - y).
        func P(_ x: CGFloat, _ y: CGFloat) -> NSPoint { NSPoint(x: ox + x * s, y: oy + (32 - y) * s) }
        let chev = NSBezierPath()
        chev.move(to: P(6.5, 8.5)); chev.line(to: P(13, 16)); chev.line(to: P(6.5, 23.5))
        chev.lineWidth = 3.1 * s; chev.lineCapStyle = .round; chev.lineJoinStyle = .round
        chev.stroke()
        func bar(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) {
            let r = NSRect(x: ox + x * s, y: oy + (32 - (y + h)) * s, width: w * s, height: h * s)
            NSBezierPath(roundedRect: r, xRadius: (w / 2) * s, yRadius: (w / 2) * s).fill()
        }
        bar(16.4, 12.5, 3, 7); bar(21.4, 8.5, 3, 15); bar(26.4, 13.5, 3, 5)
    }

    // Idle: a monochrome template (auto-tints to the menu bar colour). Waiting /
    // muted: composite the mark with a coloured status dot (yellow / red + slash).
    private func statusImage(muted: Bool, waiting: Bool) -> NSImage {
        let size = NSSize(width: 20, height: 16)
        let rect = NSRect(origin: .zero, size: size)

        if !muted && !waiting {
            let img = NSImage(size: size)
            img.lockFocus()
            NSColor.black.setStroke(); NSColor.black.setFill()
            drawMark(in: rect)
            img.unlockFocus()
            img.isTemplate = true // system tints to the menu bar color
            return img
        }

        let dark = (statusItem.button?.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua)
        let fg: NSColor = muted ? .tertiaryLabelColor : (dark ? .white : .black)
        let img = NSImage(size: size)
        img.lockFocus()
        fg.setStroke(); fg.setFill()
        drawMark(in: rect)
        // status dot, top-right
        let d: CGFloat = 6
        (muted ? NSColor.systemRed : NSColor.systemYellow).set()
        NSBezierPath(ovalIn: NSRect(x: size.width - d, y: size.height - d, width: d, height: d)).fill()
        if muted { // red slash
            let sl = NSBezierPath(); sl.lineWidth = 1.6
            sl.move(to: NSPoint(x: 1.5, y: 1.5)); sl.line(to: NSPoint(x: size.width - 1.5, y: size.height - 1.5))
            NSColor.systemRed.set(); sl.stroke()
        }
        img.unlockFocus()
        img.isTemplate = false
        return img
    }

    private func render() {
        guard let b = statusItem.button else { return }
        b.title = ""
        b.image = statusImage(muted: State.isEffectivelyMuted, waiting: State.hasWaiting)
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

    @objc private func volumeChanged(_ s: NSSlider) {
        State.setVolume(s.doubleValue)
        // Dragging the volume ABOVE 0 means "I want to hear this": clear an
        // explicit mute. Dragging to 0 is itself a mute (silence), so we leave
        // the flag alone and let isEffectivelyMuted keep the 🔇 / slash mark.
        if s.doubleValue > 0 && State.isMuted { State.setMuted(false) }
        globalVolumeIcon?.stringValue = State.isEffectivelyMuted ? "🔇" : "🔊"
        render()
    }
    // The slider is shown REVERSED: left = ツン (far-left = 極寒), center = off, right =
    // デレ (far-right = デレデレ). The file keeps the canonical scale (0 = デレ … 1 = ツン),
    // so the knob sits at 1 - value and we write back 1 - position.
    @objc private func tsundereLevelChanged(_ s: NSSlider) { State.setTsundereLevel(1 - s.doubleValue) }
    @objc private func tsundereToggled(_ sender: Any) {
        State.cli(["tsundere", "toggle"])
        setRowEnabled(tsundereSlider, tsundereCap, (sender as? NSSwitch)?.state == .on)
    }
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
        slider.trackFillColor = ACCENT_BLUE // stay blue even when the menu isn't key
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

    // Edit a pane's extra readings (aliases). Comma/space separated; empty clears.
    @objc private func promptPaneAlias(_ sender: NSMenuItem) {
        guard let info = sender.representedObject as? [String], let tty = info.first else { return }
        let current = info.count > 1 ? info[1] : ""
        let alert = NSAlert()
        alert.messageText = "別名（エイリアス）"
        alert.informativeText = "このペインを呼べる別の読み方。カンマ区切り（例: Paul, ぽーる）。空欄で解除。"
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
        field.stringValue = current
        field.placeholderString = "例: Paul, ぽーる"
        alert.accessoryView = field
        alert.addButton(withTitle: "保存")
        alert.addButton(withTitle: "自動類推")   // infer from the pane's name
        alert.addButton(withTitle: "キャンセル")
        NSApp.activate(ignoringOtherApps: true)
        alert.window.initialFirstResponder = field
        let resp = alert.runModal()
        if resp == .alertSecondButtonReturn { State.cli(["alias-pane", tty, "auto"]); return }
        guard resp == .alertFirstButtonReturn else { return }
        let v = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        State.cli(["alias-pane", tty, v.isEmpty ? "clear" : v])
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
        slider.trackFillColor = ACCENT_BLUE // stay blue even when the menu isn't key
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
        // The global row (identifier == nil) reflects mute state: 🔇 when muted
        // OR the volume is 0, so the icon and the menu bar icon agree. Dragging
        // the slider above 0 unmutes (see volumeChanged), flipping this to 🔊.
        let muted = identifier == nil && State.isEffectivelyMuted
        let icon = NSTextField(labelWithString: muted ? "🔇" : "🔊"); icon.frame = NSRect(x: 12, y: 4, width: 20, height: 18)
        let slider = NSSlider(value: value, minValue: 0, maxValue: 2, target: self, action: action)
        slider.frame = NSRect(x: 36, y: 3, width: 170, height: 20)
        slider.trackFillColor = ACCENT_BLUE // stay blue even when the menu isn't key
        slider.isContinuous = (identifier == nil)
        if let id = identifier { slider.identifier = NSUserInterfaceItemIdentifier(id) }
        if identifier == nil { globalVolumeIcon = icon }
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
        slider.trackFillColor = ACCENT_BLUE // stay blue even when the menu isn't key
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

    // A labeled level slider (0–1), laid out like the 速さ/高さ/抑揚 rows so ツンデレ /
    // 心理的安全性 sit with them. `colors` (left,right) draws a meaning-coded gradient
    // track (ツン青→デレピンク / ブラック黒→ホワイト白).
    private func levelRow(label: String, value: Double, enabled: Bool = true, colors: (NSColor, NSColor)? = nil,
                          action: Selector, onBuild: ((NSSlider, NSTextField) -> Void)? = nil) -> NSMenuItem {
        let row = NSView(frame: NSRect(x: 0, y: 0, width: 270, height: 24))
        // Indented sub-label under its toggle. Wide enough for the full text
        // ("ブラック⇔ホワイト") and dimmed further when the toggle is OFF.
        let cap = NSTextField(labelWithString: label)
        cap.frame = NSRect(x: 26, y: 4, width: 104, height: 16)
        cap.font = .systemFont(ofSize: 10)
        cap.textColor = enabled ? .secondaryLabelColor : .tertiaryLabelColor
        cap.lineBreakMode = .byClipping
        // Gradient slider built WITH its custom cell class from the start (swapping
        // .cell after construction breaks mouse tracking), so dragging still updates.
        let slider: NSSlider = colors != nil
            ? GradientSlider(value: value, minValue: 0, maxValue: 1, target: self, action: action)
            : NSSlider(value: value, minValue: 0, maxValue: 1, target: self, action: action)
        if let (lo, hi) = colors, let cell = slider.cell as? GradientSliderCell {
            cell.startColor = lo; cell.endColor = hi
        }
        slider.frame = NSRect(x: 132, y: 3, width: 126, height: 20)
        slider.isContinuous = false
        slider.isEnabled = enabled // isEnabled=false greys it out so an OFF toggle reads as off
        row.addSubview(cap); row.addSubview(slider)
        onBuild?(slider, cap)
        let item = NSMenuItem(); item.view = row
        return item
    }

    // Flip a skin slider's enabled/greyed look in place (no menu rebuild) when its
    // toggle switch is clicked.
    private func setRowEnabled(_ slider: NSSlider?, _ cap: NSTextField?, _ on: Bool) {
        slider?.isEnabled = on
        cap?.textColor = on ? .secondaryLabelColor : .tertiaryLabelColor
    }

    @objc private func warToggled(_ sender: Any) {
        State.cli(["war", "toggle"])
        setRowEnabled(psafetySlider, psafetyCap, (sender as? NSSwitch)?.state == .on)
    }
    @objc private func warLevelChanged(_ s: NSSlider) { State.cli(["war", "level", String(format: "%.2f", s.doubleValue)]) }
    @objc private func summaryLevelChanged(_ s: NSSlider) { State.cli(["summary", String(format: "%.2f", s.doubleValue)]) }
    // Reversed like the other tsundere sliders: left = ツン, right = デレ → write 1 - pos.
    @objc private func tsundereLevelDirect(_ s: NSSlider) { State.cli(["tsundere", "level", String(format: "%.2f", 1 - s.doubleValue)]) }

    // representedObject is the full CLI arg array to run.
    @objc private func runItem(_ item: NSMenuItem) {
        if let cmd = item.representedObject as? [String] { State.cli(cmd) }
    }

    // Set the speaker's voice-input language (ja|en). Persisted via the CLI so
    // both `ai-notify reply` (romaji gating) and this app's whisper request agree.
    @objc private func setSpeakerLang(_ item: NSMenuItem) {
        if let code = item.representedObject as? String { State.cli(["voice-lang", code]) }
    }

    // Show/hide the floating recognition caption.
    @objc private func toggleCaption(_ sender: NSMenuItem) {
        State.setCaption(!State.captionEnabled)
        if !State.captionEnabled { caption.hide() }
    }

    // Push-to-talk: capture only while the talk key (default Fn) is held.
    @objc private func togglePushToTalk(_ sender: NSMenuItem) {
        State.setPushToTalk(!State.pushToTalk)
        voice.setPushToTalk(State.pushToTalk)
        if State.pushToTalk {
            installPTTMonitor()
            let name = Self.pttKeyOptions.first { $0.code == State.pttKeyCode }?.name ?? "Fn"
            notify("プッシュトゥトーク: ON（\(name) 長押し）",
                   "バックグラウンド常駐のため『入力監視』権限が必要です：\nシステム設定 › プライバシーとセキュリティ › 入力監視 で ai-notify を許可。")
        } else {
            removePTTMonitor()
        }
    }
    @objc private func setPTTKey(_ sender: NSMenuItem) {
        State.setPTTKeyCode(sender.tag)
        if State.pushToTalk { removePTTMonitor(); installPTTMonitor() }
    }
    @objc private func togglePartial(_ sender: NSMenuItem) {
        State.setPartialCaptions(!State.partialCaptions)
    }

    private func notify(_ title: String, _ info: String) {
        let a = NSAlert(); a.messageText = title; a.informativeText = info; a.runModal()
    }

    // Flip the mic wake-word loop on/off. Enabling is async (permission prompts);
    // the flag is only persisted once it actually starts, and a denial shows why.
    @objc private func toggleVoiceInput(_ sender: NSMenuItem) {
        if State.voiceInputEnabled {
            State.setVoiceInput(false)
            voice.disable()
            return
        }
        voice.enable { ok, msg in
            if ok {
                State.setVoiceInput(true)
            } else {
                let a = NSAlert()
                a.messageText = "音声操作を開始できませんでした"
                a.informativeText = msg
                a.alertStyle = .warning
                a.runModal()
            }
        }
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
        // 要約度: how much of the message is read aloud — left(0)=効果音のみ … right(1)=全文.
        let summaryLevel = ((json?["summary"] as? [String: Any])?["level"] as? Double) ?? 0.25
        menu.addItem(levelRow(label: "要約度", value: summaryLevel, colors: SUMMARY_GRADIENT, action: #selector(summaryLevelChanged(_:))))
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
        // 心理的安全性 slider is direct (left=ブラック/0, right=ホワイト/1, center=off).
        menu.addItem(toggleSwitchRow("ツンデレ", on: tsunOn, action: #selector(tsundereToggled(_:))))
        menu.addItem(levelRow(label: "ツン⇔デレ", value: 1 - tsunLevel, enabled: tsunOn, colors: TSUNDERE_GRADIENT, action: #selector(tsundereLevelDirect(_:)),
                              onBuild: { [weak self] s, c in self?.tsundereSlider = s; self?.tsundereCap = c }))
        menu.addItem(toggleSwitchRow("心理的安全性", on: warOn, action: #selector(warToggled(_:))))
        menu.addItem(levelRow(label: "ブラック⇔ホワイト", value: warLevel, enabled: warOn, colors: PSAFETY_GRADIENT, action: #selector(warLevelChanged(_:)),
                              onBuild: { [weak self] s, c in self?.psafetySlider = s; self?.psafetyCap = c }))
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
                // Per-pane aliases (extra readings: ポール / ぽーる / Paul). Lets a
                // pane be addressed however whisper renders the spoken name.
                let aliases = (p["aliases"] as? [String]) ?? []
                sub.addItem(disabledHeader("別名（エイリアス）"))
                let aliasItem = NSMenuItem(
                    title: aliases.isEmpty ? "（クリックして追加…）" : "「\(aliases.joined(separator: "・"))」を変更…",
                    action: #selector(promptPaneAlias(_:)), keyEquivalent: ""
                )
                aliasItem.target = self
                aliasItem.representedObject = [tty, aliases.joined(separator: ", ")]
                sub.addItem(aliasItem)
                let aliasAuto = NSMenuItem(title: "名前から自動類推", action: #selector(runItem(_:)), keyEquivalent: "")
                aliasAuto.target = self; aliasAuto.representedObject = ["alias-pane", tty, "auto"]
                aliasAuto.isEnabled = !pname.isEmpty
                sub.addItem(aliasAuto)
                if !aliases.isEmpty {
                    let aclr = NSMenuItem(title: "別名を解除", action: #selector(runItem(_:)), keyEquivalent: "")
                    aclr.target = self; aclr.representedObject = ["alias-pane", tty, "clear"]
                    sub.addItem(aclr)
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
                // Per-pane 心理的安全性 (center = off; left ブラック / right ホワイト).
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
        // Voice input (音声操作): speak "<pane name>、<command>" to drive a waiting
        // agent hands-free (requires tmux + mic/speech permission).
        let voiceItem = NSMenuItem(title: "🎙️ 音声操作（ハンズフリー指示）", action: #selector(toggleVoiceInput(_:)), keyEquivalent: "")
        voiceItem.target = self
        voiceItem.state = State.voiceInputEnabled ? .on : .off
        menu.addItem(voiceItem)

        // Speaker's language — drives whisper transcription + (for ja) the romaji
        // name matcher. A Japanese speaker wants ja; an English speaker wants en
        // (where ja-forcing + romaji folding would just get in the way).
        let langParent = NSMenuItem(title: "　🗣 話者の言語 / Speaker", action: nil, keyEquivalent: "")
        let langSub = NSMenu()
        let curLang = State.speakerLang
        for (code, label) in [("ja", "日本語"), ("en", "English")] {
            let it = NSMenuItem(title: label, action: #selector(setSpeakerLang(_:)), keyEquivalent: "")
            it.target = self
            it.representedObject = code
            it.state = (curLang == code) ? .on : .off
            langSub.addItem(it)
        }
        langParent.submenu = langSub
        menu.addItem(langParent)

        // Floating caption that shows what was just recognized (on by default).
        let capItem = NSMenuItem(title: "　📝 認識した言葉を画面に表示", action: #selector(toggleCaption(_:)), keyEquivalent: "")
        capItem.target = self
        capItem.state = State.captionEnabled ? .on : .off
        menu.addItem(capItem)

        // Live partial captions (interim words while speaking).
        let partialItem = NSMenuItem(title: "　⚡️ 話している途中もリアルタイム表示", action: #selector(togglePartial(_:)), keyEquivalent: "")
        partialItem.target = self
        partialItem.state = State.partialCaptions ? .on : .off
        menu.addItem(partialItem)

        // Push-to-talk on/off + key picker.
        let pttItem = NSMenuItem(title: "　🎙 プッシュトゥトーク（押している間だけ）", action: #selector(togglePushToTalk(_:)), keyEquivalent: "")
        pttItem.target = self
        pttItem.state = State.pushToTalk ? .on : .off
        menu.addItem(pttItem)
        let pttKeyParent = NSMenuItem(title: "　　PTTキー", action: nil, keyEquivalent: "")
        let pttKeySub = NSMenu()
        for opt in Self.pttKeyOptions {
            let it = NSMenuItem(title: opt.name, action: #selector(setPTTKey(_:)), keyEquivalent: "")
            it.target = self; it.tag = opt.code
            it.state = State.pttKeyCode == opt.code ? .on : .off
            pttKeySub.addItem(it)
        }
        pttKeyParent.submenu = pttKeySub
        menu.addItem(pttKeyParent)

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
