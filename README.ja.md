<p align="center">
  <img src="https://raw.githubusercontent.com/unoryota/ai-notify/main/assets/logo.svg" width="88" alt="ai-notify logo">
</p>

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
- 📝 **「何をしたか」を教える。** 完了通知は「終わりました」だけでなく、エージェントの最後の返信（transcript）から作業内容を要約します。しかも**いまのターンの返信だけ**を読み、前のターンの古い要約が混ざりません。
- 🔕 **1スイッチで全部ミュート。** 全エージェント・全ターミナルが同じフラグを読むので、会議中はワンタップで全部静かに。ミュートは**完全無音**：音もデスクトップ通知も出しません（通知を出すと macOS 側のピング音が鳴ってしまうため）。待機中のペインはメニューバーが**黄色**になって分かります。
- 🔔 **ネイティブのメニューバーも内蔵。** `ai-notify menubar install` — Hammerspoon/SwiftBar 不要。

エージェントの返答を翻訳・VOICEVOX キャラの一覧・ツンデレ口調のクイックツアー：

![ai-notify の機能: 翻訳・VOICEVOXボイス・ツンデレ](https://raw.githubusercontent.com/unoryota/ai-notify/main/assets/features.gif)

## 対応エージェント

| エージェント | 状態 | 配線方法 |
| ----- | ------ | -------------- |
| Claude Code | ✅ | `~/.claude/settings.json` の `Notification` + `Stop` フック |
| Codex CLI | ✅ | `~/.codex/config.toml` の `notify`（`agent-turn-complete`） |
| Gemini CLI | 🧪 実験的 | `~/.gemini/settings.json` の `AfterAgent` + `Notification` フック |

別のエージェント（aider, opencode, amp …）の追加は小さなPRで可能：`src/providers/` にファイルを1つ置くだけ。[CONTRIBUTING](CONTRIBUTING.md) 参照。

## コマンド

```sh
ai-notify init [--dry-run] [--only claude,codex]   # 検出したエージェントを配線
ai-notify use <名前> [声] [音量] [--tab <名前>]      # このペインの名前＋声＋タブ名を一括設定
ai-notify toggle | on | off | status               # ミュートスイッチ
ai-notify volume [0.0-2.0]                          # 音量の取得／設定
ai-notify voice [number|name|preview|default]      # 読み上げ音声を選ぶ
ai-notify voicevox [on <id>|off|speakers|test]     # VOICEVOXの声で読み上げ
ai-notify tsundere [on|off|level <0-1>|test|status]   # ツンデレ（トグルON/OFF＋両極スライダー・中央=OFF）
ai-notify safety   [on|off|level <0-1>|test|status]   # 心理的安全性（トグル＋両極・0=ブラック … 0.5=OFF … 1=ホワイト）
ai-notify notify [<kind> on|off]                   # 通知する種類（input|permission|done|…）
ai-notify popup [on|off|image|delay|ignore|portraits]  # 応答待ちキャラポップアップ（macOS）
ai-notify preset [list|save|load|delete <名前>]     # 設定の保存／復元
ai-notify translate [on <lang>|off|test]           # エージェントの文章を自分の言語で
ai-notify menubar [install|uninstall|status]       # ネイティブのメニューバー（macOS）
ai-notify doctor                                   # 依存・配線の確認
ai-notify uninstall                                # 配線をきれいに削除
```

**ペインの設定を1コマンドで。** エージェントを動かす端末の中でこれを実行すると、読み上げ名・声・音量・**ターミナルのタブ名**を一度に設定できます。メニュー操作は不要：

```sh
ai-notify use api Kyoko                       # 名前「api」＋声 Kyoko＋タブ名→api
ai-notify use web Eddy 0.8                    # ＋音量 0.8
ai-notify use zunda ずんだもん                 # 声は VOICEVOX キャラ名で指定（vv3 でも可）
ai-notify use エックスズンダモン ずんだもん --tab x_zunda   # 読み上げ名とタブ名を別々に
ai-notify use clear                           # このペインをリセット
```

`声` は `say` の名前/番号（`Kyoko`・`3`）、VOICEVOX の**キャラ名**（`ずんだもん`）、`vv<id>`（`vv3`）が使えます。`--tab` で読み上げ名と別のタブ名を付けられます。

> タブ名の変更はベストエフォートで、標準のタイトルエスケープ（OSC 0＋2）を送ります。**Terminal.app** と **iTerm2** は反映します。**JetBrains 系（WebStorm/IntelliJ）は新ターミナル（Reworked・2025.2 以降が既定）でのみ反映**し、バージョンによってはタブを再アクティブにすると名前が戻ります（[IDEA-277846](https://youtrack.jetbrains.com/issue/IDEA-277846/Support-changing-terminal-tab-title-by-escape-sequences)）。プロンプト毎にタイトルを書き換えるシェル設定でも上書きされます。読み上げ名と声は端末に関係なく常に有効です。

ペイン別の上書き — エージェントを起動する**前**に、その端末で `export` する：

```sh
AI_NOTIFY_LABEL=api               # この窓の読み上げ／通知での名前
AI_NOTIFY_VOICE=Eddy              # この窓の `say` 音声
AI_NOTIFY_VOICEVOX_SPEAKER=3      # この窓の VOICEVOX 話者ID
AI_NOTIFY_VOLUME=0.5              # この窓の音量（0.0〜2.0）
AI_NOTIFY_TSUNDERE_LEVEL=0.8     # この窓のツンデレ既定値（0=デレ〜1=ツン）
```

## 🔔 どの種類で通知するか

すべての出来事に音とバナーが要るわけではありません。ai-notify は各イベントを（Claude Code の `notification_type`・サブエージェント判定で）**種類**に分類し、どの種類で通知するかを選べます：

```sh
ai-notify notify                       # 一覧を表示
ai-notify notify done off              # ターン完了では鳴らさない
ai-notify notify subagent-done on      # サブエージェント完了で鳴らす
```

| 種類 | いつ | 既定 |
| ---- | ---- | ---- |
| `input` | **あなたの入力**待ち（`idle_prompt`） | 🔔 ON |
| `permission` | **許可**プロンプト | 🔔 ON |
| `info` | 認証 / MCP elicitation（情報通知） | 🔕 OFF |
| `done` | ターン**完了**（Stop） | 🔔 ON |
| `subagent-done` | **サブエージェント**完了（SubagentStop） | 🔕 OFF |

OFF の種類は完全に無音（音・バナー・読み上げ・ポップアップなし）。ただし待ち状態は正しく保たれます（無音化した `done` でもポップアップは消えます）。同じ切替はメニューバーの **通知する種類** にもあります。（`subagent-done` は SubagentStop フック配線のため一度 `ai-notify init` が必要）

> 注意：Claude は「サブエージェントの実行を待っているだけ」では通知を出しません（`Notification` は**あなたが必要なとき**だけ発火）。つまり「入力待ち」と「サブエージェントで作業中」は別々の通知ではなく、上の種類が実際に区別できる単位です。

## 🎛️ ネイティブのメニューバー — ミュート・音量・声

エージェントが走っているターミナルにはコマンドを打てないので、**メニューバー**から全部操作します：

```sh
ai-notify menubar install   # ネイティブのメニューバーアプリ・ログイン時に自動起動
```

モノクロの波形アイコンが**状態を色で**表します（Adobe風）：通常はシルエットのみ、入力待ちがあると**黄ドット**、ミュート中は**赤＋斜線**。ミュートは**完全無音**——音もデスクトップ通知も出しません（通知を出すと macOS 側のピング音が鳴ってしまうため）。それでも待機中のペインは黄アイコン＋ウィンドウのハイライトで分かるので、席に戻ったときに見落としません。

- **左クリック** → メニュー：**音量**スライダー・読み上げ（**速さ/高さ/抑揚**）スライダー・**ツンデレ**と**心理的安全性**の各**ON/OFFトグルスイッチ＋両極スライダー**（どちらも中央＝OFF）、**声の一覧**（システム＋VOICEVOX）、そして各ターミナルの**ペイン別サブメニュー**。ペイン別では**全パラメータ**（読み上げ名・声・音量・ツンデレ・心理的安全性・速さ/高さ/抑揚）を個別に上書きできます。
- **右クリック** → 即ミュート切替。
- **⚙ 設定…** → **整列したスライダー＋編集可能な数値フィールド**と**プリセット保存**（`ai-notify preset save <名前>` / `load` / `delete`）の設定ウィンドウ。毎回調整し直さなくて済みます。

<img alt="ai-notify メニュー — 音量・速さ/高さ/抑揚のスライダー、ツンデレと心理的安全性のON/OFFトグル＋スライダー、声の一覧、ターミナルごとのペイン別行" src="https://raw.githubusercontent.com/unoryota/ai-notify/main/assets/menubar.png" width="280">

*メニュー：音量・速さ/高さ/抑揚のスライダー、ツンデレと心理的安全性のON/OFFトグル＋両極スライダー、声の一覧、そしてターミナルごとのペイン別行（🗣 名前 — 🔊 声）。各行を開くとそのペイン専用の上書き設定が出ます。*

**⚙ 設定ウィンドウ** — 全スライダーを1つのグリッドに整列、横に編集可能な数値、上部にプリセットの保存/復元バー：

![ai-notify 設定ウィンドウ](https://raw.githubusercontent.com/unoryota/ai-notify/main/assets/settings.png)

第三者アプリ不要。別の方法が好みなら、**Hammerspoon**・**SwiftBar/xbar**・**Raycast**・標準の**ショートカット**用レシピが [`recipes/`](recipes/) にあります。`ai-notify status --icon` は `🔔`/`🔕` だけを出力するので、tmux・プロンプト・Claude Code のステータスラインに埋め込めます。

> 切替は実行中でも効きます：次にエージェントが発火した時にフラグを読むので、トグルした瞬間に全稼働エージェントへ反映されます。

## 🪧 「応答待ち」ポップアップ

エージェントが止まってあなたの入力を待っている状態は、ターミナルが多いと見落としがち。とくに IDE（WebStorm・VS Code）のターミナルは画像やリッチ通知を出せません。**常に最前面のキャラポップアップ**をオンにすると、応答待ちのペイン名を表示し、応答した瞬間に消えます：

![ai-notify 応答待ちポップアップ](https://raw.githubusercontent.com/unoryota/ai-notify/main/assets/popup.png)

```sh
ai-notify popup on                      # 有効化（メニューバーの「応答待ちポップアップ」でも切替）
ai-notify popup image ~/zundamon.png    # 好きなキャラ画像（PNG/JPG）。既定は顔文字
ai-notify popup off
```

全アプリ・全スペースの上に浮かびます。**待っているペインごとに1枚のカード**が右下に積み重なり、各カードはそのペインの **VOICEVOX のボイスのキャラ立ち絵**を表示します（ずんだもんの声のペインはずんだもん、春日部つむぎの声はつむぎ）。カードをクリックで個別に消せます。macOS 専用（メニューバーアプリの導入が必要）。

```sh
ai-notify popup portraits   # 各VOICEVOXキャラの公式立ち絵をキャッシュ（初回のみ・エンジン起動が必要）
```

ここの設定はすべてメニューバーからも操作できます：**応答待ちポップアップ** →「有効にする／待ち時間／無視ワード／ボイスの立ち絵を取得」。

**出す条件を設定できます。** すべての「待ち」で割り込まれたくない人向け。サブエージェントの一瞬の待ちは黙ってほしいが、本当の「入力待ち」は気づきたい——を出し分けられます：

```sh
ai-notify popup delay 15                 # 15秒以上待っている時だけ出す（一瞬の待ちは無視）
ai-notify popup ignore subagent,task     # 待ち理由テキストにこの語を含む時は出さない
ai-notify popup ignore clear             # フィルタ解除
```

フィルタは Claude Code の通知理由（例「waiting for your input」やサブエージェント系メッセージ）に対して効くので、入力/許可待ちは残しつつ、それ以外を黙らせられます。

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

読み上げに「ツンデレ」人格を載せます。**マスターのON/OFFトグルスイッチ**で有効化し、**両極スライダー**で口調を決めます。中央(0.5)＝OFF、**左に振るほどツン**（最左端は隠れデレ無しの**極寒デレ0**「…で、それが何か？」）、**右に振るほどデレ**（最右端は甘々の**デレデレ**）。**5段階**：極寒 ← ツン ←（OFF）→ デレ → デレデレ。

```sh
ai-notify tsundere on            # マスタースイッチON（off / toggle も）
ai-notify tsundere level 0.7     # CLI値は 0=デレ … 0.5=OFF … 1=ツン（メニューのスライダーは左ツン/右デレで反転表示）
ai-notify tsundere test          # 各イベントで試聴
```

口調は**常にスライダー位置どおり**。ツンにしておけば成功時も**しぶしぶツン**（「…ま、まあ及第点ね。別に褒めてないんだからね！」）で、ベタ褒めデレにはなりません。緊急度は「**どの台詞か**」と「**音量**」（失敗は大きめ）にだけ効き、ツン⇄デレの口調自体は飛び越えません。**無API・決定論・オフライン**。**VOICEVOX**なら声色も**ツンツン／あまあま**に。`lang` は `ja` / `en`。

## 🏢 心理的安全性（任意・遊び心）

ツンデレとは別の読み上げスキン。**職場のマネジメント環境**を**中央＝OFFの両極スライダー**で表します。**マスターのON/OFFトグルスイッチ**で有効化し、スライダーでどちら側・どれくらい強いかを決めます：

```sh
ai-notify safety on             # マスタースイッチON（off / toggle も）
ai-notify safety level 0.1      # 0=ブラックMAX … 0.5=OFF … 1=ホワイトMAX
ai-notify safety test           # 両極端を試聴
```

- **左 → ブラック企業／詰める鬼上司** — 高圧・怒号・残業強要、音量↑（「今すぐ直して、終わるまで帰れると思わないで！」）。スライダーの track は左ほど黒。
- **中央 → OFF** — 素の読み上げ。
- **右 → ホワイト企業／心理的安全性が高い** — 優しく寄り添う、ゆっくり柔らかく（「全然大丈夫ですよ、まずは深呼吸して。失敗は学びです」）。
- 端に寄るほど強く。**無API・決定論・オフライン**。**VOICEVOX**ならブラックはツンツン、ホワイトはあまあまの声色に。（`safety` が正式名で、旧 `war` コマンドもエイリアスとして使えます。）

**ツンデレ**も**心理的安全性**も仕組みは同じ：**トグルスイッチ**でスキンをONにし、**中央OFFの両極スライダー**で口調／側を決めます。各スライダーの track は**意味を表すグラデーション**で、ツンデレは 冷たい青(ツン)→あたたかいピンク(デレ)、心理的安全性は 黒(ブラック企業)→白(ホワイト企業)。ノブの左だけ塗られ右はグレー、トグルOFF時は全体がグレーアウトします。メニューバーでは速さ/高さ/抑揚の下にトグル＋スライダーで並び、⚙設定ウィンドウにもあります。各ペインのサブメニューで**全パラメータ**（名前・声・音量・ツンデレ・心理的安全性・速さ/高さ/抑揚）を個別に上書きできます。両方ONなら**組み合わさります**：心理的安全性の**側（ブラック/ホワイト）が環境**、ツンデレの**口調（ツン/デレ）が人格**を決め、`ブラック×デレ`（「こんな環境なのにえらいよ、でも体だけは大事にしてね？」）と `ブラック×ツン`（冷たく詰める）は別物になります。片方OFFならもう片方だけが効きます。

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
