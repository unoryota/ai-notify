# ai-notify

[English](README.md) · **日本語**

**ターミナルのAIエージェントが「あなたを必要とした瞬間」を逃さない** — Claude Code・Codex などのエージェントがターンを終えた／入力を求めた瞬間に、音・読み上げ・デスクトップ通知で知らせます。**全エージェント・全ターミナルを1つのスイッチで一括ミュート**。デーモンも常駐プロセスも無し。

![ai-notify demo](https://raw.githubusercontent.com/unoryota/ai-notify/main/assets/hero-ja.gif)

```sh
npm i -g ai-notify
ai-notify init        # インストール済みのエージェントを自動検出して配線
```

## 何が違うか

エージェントは数分間も沈黙しがち。ai-notify は適切な瞬間に呼び戻します。とくに **AIを並列でたくさん動かす運用**のために作られています：

- 🎙️ **ターミナルごとに声を変えられる。** ペインごとに別の声を割り当てれば、**どの窓が終わったか**を聞くだけで分かります — `export AI_NOTIFY_VOICE=Eddy`（または [VOICEVOX](#-voicevox-キャラクターボイス) のキャラ）。
- 🌐 **あなたの言語で読み上げ。** エージェントの英語の返信・プロンプトを翻訳してから読み上げ／表示（キーレス・無料）。日本人にうれしい。
- 📝 **「何をしたか」を教える。** 完了通知は「終わりました」だけでなく、エージェントの最後の返信（transcript）から作業内容を要約します。
- 🔕 **1スイッチで全部ミュート。** 全エージェント・全ターミナルが同じフラグを読むので、会議中はワンタップで全部静かに。
- 🔔 **ネイティブのメニューバーも内蔵。** `ai-notify menubar install` — Hammerspoon/SwiftBar 不要。

## 対応エージェント

| エージェント | 状態 | 配線方法 |
| ----- | ------ | -------------- |
| Claude Code | ✅ | `~/.claude/settings.json` の `Notification` + `Stop` フック |
| Codex CLI | ✅ | `~/.codex/config.toml` の `notify`（`agent-turn-complete`） |
| Gemini CLI | 🧪 検出のみ・フック作業中 | PR歓迎 |

別のエージェント（aider, opencode, amp …）の追加は小さなPRで可能：`src/providers/` にファイルを1つ置くだけ。[CONTRIBUTING](CONTRIBUTING.md) 参照。

## コマンド

```sh
ai-notify init [--dry-run] [--only claude,codex]   # 検出したエージェントを配線
ai-notify toggle | on | off | status               # ミュートスイッチ
ai-notify volume [0.0-2.0]                          # 音量の取得／設定
ai-notify voice [number|name|preview|default]      # 読み上げ音声を選ぶ
ai-notify voicevox [on <id>|off|speakers|test]     # VOICEVOXの声で読み上げ
ai-notify translate [on <lang>|off|test]           # エージェントの文章を自分の言語で
ai-notify menubar [install|uninstall|status]       # ネイティブのメニューバー（macOS）
ai-notify doctor                                   # 依存・配線の確認
ai-notify uninstall                                # 配線をきれいに削除
```

ペイン別の上書き — エージェントを起動する**前**に、その端末で `export` する：

```sh
AI_NOTIFY_LABEL=api               # この窓の読み上げ／通知での名前
AI_NOTIFY_VOICE=Eddy              # この窓の `say` 音声
AI_NOTIFY_VOICEVOX_SPEAKER=3      # この窓の VOICEVOX 話者ID
AI_NOTIFY_VOLUME=0.5              # この窓の音量（0.0〜2.0）
```

## 🎛️ ネイティブのメニューバー — ミュート・音量・声

エージェントが走っているターミナルにはコマンドを打てないので、**メニューバー**から全部操作します：

```sh
ai-notify menubar install   # ネイティブのメニューバーアプリ・ログイン時に自動起動
```

モノクロの波形アイコンが**状態を色で**表します（Adobe風）：通常はシルエットのみ、入力待ちがあると**黄ドット**、ミュート中は**赤＋斜線**。

- **左クリック** → メニュー：**音量スライダー**、**声の一覧**（システム＋VOICEVOX）、**ペイン別**設定（開いている各ターミナルに個別の声と音量）。
- **右クリック** → 即ミュート切替。

第三者アプリ不要。別の方法が好みなら、**Hammerspoon**・**SwiftBar/xbar**・**Raycast**・標準の**ショートカット**用レシピが [`recipes/`](recipes/) にあります。`ai-notify status --icon` は `🔔`/`🔕` だけを出力するので、tmux・プロンプト・Claude Code のステータスラインに埋め込めます。

> 切替は実行中でも効きます：次にエージェントが発火した時にフラグを読むので、トグルした瞬間に全稼働エージェントへ反映されます。

## 🎙️ VOICEVOX キャラクターボイス

通知を [VOICEVOX](https://voicevox.hiroshiba.jp/) のキャラ声（例：ずんだもん）で読み上げられます（無料・ローカル・オフライン）。

> **VOICEVOXアプリのインストールと起動が必要です。** ai-notify はローカルのエンジンを叩くだけで、音声データは同梱していません。未起動なら ai-notify は**OS標準の音声**（Samantha, Kyoko …）を使います（こちらは設定不要ですぐ動きます）。

VOICEVOXアプリを起動してから：

```sh
ai-notify voicevox speakers     # 利用可能なキャラとIDの一覧
ai-notify voicevox on 3         # 話者3（例：ずんだもん）を使う
```

`AI_NOTIFY_VOICEVOX_SPEAKER` で各ペインに別キャラを割り当て可能。エンジンが起動していなければ自動でOS音声にフォールバックします。
*VOICEVOXのキャラには利用規約があります。録画などを共有する場合は [VOICEVOXのガイドライン](https://voicevox.hiroshiba.jp/term/) に従ってクレジットしてください。*

## 🌐 あなたの言語で読み上げ

```sh
ai-notify translate on ja       # エージェントのメッセージを翻訳してから読み上げ
ai-notify translate test "I fixed the auth bug and added 3 tests."
```

キーレス・無料（HTTP 1リクエスト。オフライン時はローカルの定型文にフォールバック）。デスクトップ通知には原文も表示されます。

## ⏳ どの窓が・何を求めているか

各通知のタイトルに窓ラベルが付きます — 入力待ちは `⏳ <label>`、完了は `✓ <label>`。本文には**何を**（翻訳されたプロンプト、または作業内容の要約）が出ます。各ペインに短い `AI_NOTIFY_LABEL` を設定すれば、10個のターミナルもひと目で見分けられます。

## 仕組み

XDGパス配下の単一のミュートフラグと設定だけ — デーモンも調整も無し：

```
${XDG_STATE_HOME:-~/.local/state}/ai-notify/muted     # 存在＝ミュート
${XDG_CONFIG_HOME:-~/.config}/ai-notify/config.json   # 音・声・各種オプション
```

各エージェントのフックが `ai-notify hook --source <agent>` を呼び、発火時にこの1つのフラグを読みます。`ai-notify config init` で編集可能な設定（エージェント別の音・声・TTSバックエンド・翻訳・テンプレート）を書き出せます。

## 対応プラットフォーム

macOS は完全対応（`afplay` / `say` / VOICEVOX / `terminal-notifier` / ネイティブメニューバー）。Linux はベストエフォート（`paplay`/`canberra`, `notify-send`, `spd-say`/`espeak`, VOICEVOX）。Windows はビープ＋PowerShell読み上げ。利用できないバックエンドは静かに縮退し、エラーにはなりません。

## ライセンス

[MIT](LICENSE)。ランタイム依存ゼロ。
