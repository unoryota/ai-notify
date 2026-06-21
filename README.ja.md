# ai-notify

[English](README.md) · **日本語**

[![npm](https://img.shields.io/npm/v/ai-notify?color=cb3837&logo=npm)](https://www.npmjs.com/package/ai-notify)
[![downloads](https://img.shields.io/npm/dw/ai-notify?color=cb3837)](https://www.npmjs.com/package/ai-notify)
[![license](https://img.shields.io/npm/l/ai-notify?color=blue)](./LICENSE)
![platform](https://img.shields.io/badge/macOS%20%C2%B7%20Linux-zero--dep-success)
[![stars](https://img.shields.io/github/stars/unoryota/ai-notify?style=social)](https://github.com/unoryota/ai-notify)

**ターミナルのAIエージェントが「あなたを必要とした瞬間」を逃さない** — Claude Code・Codex などのエージェントがターンを終えた／入力を求めた瞬間に、音・読み上げ・デスクトップ通知で知らせます。**全エージェント・全ターミナルを1つのスイッチで一括ミュート**。デーモンも常駐プロセスも無し。

![ai-notify demo](https://raw.githubusercontent.com/unoryota/ai-notify/main/assets/hero-ja.gif)

```sh
brew install unoryota/tap/ai-notify   # macOS（Homebrew）
# または:  npm i -g ai-notify

ai-notify init        # インストール済みのエージェントを自動検出して配線
```

セットアップはこれだけ。`init` が Claude Code / Codex / Gemini を見つけてフックを配線します。あとは1つのスイッチで全部を操作できます：

![ai-notify の使い方: init・status・一括ミュート・声の切替](https://raw.githubusercontent.com/unoryota/ai-notify/main/assets/usage.gif)

## 何が違うか

エージェントは数分間も沈黙しがち。ai-notify は適切な瞬間に呼び戻します。とくに **AIを並列でたくさん動かす運用**のために作られています：

- 🎙️ **ターミナルごとに声を変えられる。** ペインごとに別の声を割り当てれば、**どの窓が終わったか**を聞くだけで分かります — `export AI_NOTIFY_VOICE=Eddy`（または [VOICEVOX](#-voicevox-キャラクターボイス) のキャラ）。
- 🌐 **あなたの言語で読み上げ。** エージェントの英語の返信・プロンプトを翻訳してから読み上げ／表示（キーレス・無料）。日本人にうれしい。
- 📝 **「何をしたか」を教える。** 完了通知は「終わりました」だけでなく、エージェントの最後の返信（transcript）から作業内容を要約します。
- 🔕 **1スイッチで全部ミュート。** 全エージェント・全ターミナルが同じフラグを読むので、会議中はワンタップで全部静かに。
- 🔔 **ネイティブのメニューバーも内蔵。** `ai-notify menubar install` — Hammerspoon/SwiftBar 不要。

エージェントの返答を翻訳・VOICEVOX キャラの一覧・ツンデレ口調のクイックツアー：

![ai-notify の機能: 翻訳・VOICEVOXボイス・ツンデレ](https://raw.githubusercontent.com/unoryota/ai-notify/main/assets/features.gif)

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
ai-notify tsundere [on|off|level <0-1>|test]       # ツンデレ口調（緊急度でツン⇄デレ）
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
AI_NOTIFY_TSUNDERE_LEVEL=0.8     # この窓のツンデレ既定値（0=デレ〜1=ツン）
```

## 🎛️ ネイティブのメニューバー — ミュート・音量・声

エージェントが走っているターミナルにはコマンドを打てないので、**メニューバー**から全部操作します：

```sh
ai-notify menubar install   # ネイティブのメニューバーアプリ・ログイン時に自動起動
```

モノクロの波形アイコンが**状態を色で**表します（Adobe風）：通常はシルエットのみ、入力待ちがあると**黄ドット**、ミュート中は**赤＋斜線**。

- **左クリック** → メニュー：**音量スライダー**、**ツンデレ**トグル＋デレ⇄ツンスライダー、**声の一覧**（システム＋VOICEVOX）、**ペイン別**設定。開いている各ターミナルに、**読み上げ名**（どのペインが終わったか声で分かる）・**声**・**音量**を個別設定でき、各行にそのペインの声が一覧表示されます。
- **右クリック** → 即ミュート切替。

<p>
  <img alt="ai-notify メニュー — 音量・ツンデレ・声" src="https://raw.githubusercontent.com/unoryota/ai-notify/main/assets/menubar.png" width="250">
  &nbsp;&nbsp;
  <img alt="ペインごとの読み上げ名と声（1ターミナル1行）" src="https://raw.githubusercontent.com/unoryota/ai-notify/main/assets/menubar-panes.png" width="250">
</p>

*左：全体の音量／ツンデレ／声。右：各ペインに名前と声を割り当て（🗣 バックエンド → Kyoko、infra → ずんだもん）。*

第三者アプリ不要。別の方法が好みなら、**Hammerspoon**・**SwiftBar/xbar**・**Raycast**・標準の**ショートカット**用レシピが [`recipes/`](recipes/) にあります。`ai-notify status --icon` は `🔔`/`🔕` だけを出力するので、tmux・プロンプト・Claude Code のステータスラインに埋め込めます。

> 切替は実行中でも効きます：次にエージェントが発火した時にフラグを読むので、トグルした瞬間に全稼働エージェントへ反映されます。

## 🎙️ VOICEVOX キャラクターボイス

通知を [VOICEVOX](https://voicevox.hiroshiba.jp/) のキャラ声（例：ずんだもん）で読み上げられます（無料・ローカル・オフライン）。

> **VOICEVOXアプリのインストールと起動が必要です。** ai-notify はローカルのエンジンを叩くだけで、音声データは同梱していません。未起動なら ai-notify は**OS標準の音声**（Samantha, Kyoko …）を使います（こちらは設定不要ですぐ動きます）。

`ai-notify voicevox setup` が案内します — ダウンロードページを開き、インストール済みならアプリを起動してエンジンの起動を待ちます。その後：

```sh
ai-notify voicevox setup        # VOICEVOXの導入／起動
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

## 💢 ツンデレモード（任意・遊び心）

読み上げに「ツンデレ」人格を載せ、**事象の緊急度で口調が変わります**：

- **失敗・危険な許可待ち** → 声大きめの鋭い**ツン**で「ちょっと！ビルドが失敗じゃない。早く直しなさいよね！」
- **問題なしのパス** → やさしい**デレ**で「…ふふ、よくやったじゃない。べ、別に褒めてないんだからね…えらいえらい。」

```sh
ai-notify tsundere on            # 既定はOFF
ai-notify tsundere level 0.6     # 既定の強さ 0（デレ）〜1（ツン）。メニューバーにもスライダー
ai-notify tsundere test          # T3/T2/T1/T0 のサンプルを試聴
```

**無API・決定論・オフライン**（テンプレートで生成。課金ゼロ）。緊急度はエージェントの文面からのキーワード推定（厳密な重大度ではなくベストエフォート）で、デスクトップ通知は素の文面のまま。**VOICEVOX**利用時は、強さに応じて同じキャラの**ツンツン／あまあま**スタイルを選ぶので、声色そのものがツン・デレに変わります。`lang` は `ja` / `en` 対応。

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
