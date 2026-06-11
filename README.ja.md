# todo-on-cmux

散らばった TODO を、[cmux](https://cmux.io) 上で並列に動く自律エージェントセッションに振り分けるツール。

`todo-on-cmux` は複数のソースから TODO を集め、実行の安全度で分類し、安全なものだけを **cmux ワークスペース内の対話型 [Claude Code](https://claude.com/claude-code) / [Codex](https://github.com/openai/codex) セッション** に投入します。各セッションは安全な範囲まで作業して `result.md` を書き、後から読んだり引き継いだりできるよう開いたままになります。危険な作業(デプロイ・削除・外部送信・PR マージ)は自動実行せず、判断のために保留します。

> 言語: [English](./README.md) · **日本語**

```
ソース ──► キュー ──► 分類 ──► ディスパッチ ──► エージェント ──► result.md ──► レポート
(add / todo.md   (SQLite)  (auto/prepare/   (cmux ペイン、
 / GitHub)                  needs_user)       Claude or Codex)
```

## 背景

小さなタスクの受信箱に対する「ファーストレスポンダー」として自律エージェントを動かす、というアイデアから出発しています。タスク管理ツールを置き換えるのではなく、手書きメモ・`todo.md` の一行・GitHub 通知といった散在するシグナルを、エージェントが実際に処理できるキューに変えます。その際、「できそう」と「無人で実行してよい」の間に明確な線を引きます。

## 必要なもの

- [cmux](https://cmux.io) がインストール・起動済みの **macOS**(ランナーが cmux ワークスペースを操作します)。
- **Node.js ≥ 22**(組み込みの `node:sqlite` を使用)。
- `PATH` 上のエージェント CLI:
  - **[Claude Code](https://claude.com/claude-code)**(`claude`)— 検証済み。auto 権限モードは Claude Code ≥ 2.1.83 と対応モデル(例: Sonnet 4.6)が必要。
  - または **[Codex](https://github.com/openai/codex)**(`codex`)— 同じ仕組みで対応。実験的なので環境で要検証。
- *(任意)* GitHub ソース用に認証済みの **`gh` CLI**。

## インストール

```sh
git clone https://github.com/Sangun-Kang/todo-on-cmux.git
cd todo-on-cmux
npm install
npm run build
npm link          # `toc`(と `todo-on-cmux`)を PATH に追加
toc help
```


## クイックスタート

```sh
# 1. タスク追加(URL は --url に。重複排除と repo 同時実行制限がこれを使う)
toc add "PR をレビューしてリスクをまとめる" --url https://github.com/you/repo/pull/42

# 2. 1サイクル実行: 収集 -> 分類 -> ディスパッチ -> レポート
toc run

# 3. cmux ワークスペースが開き、エージェントが作業する。見ながら:
toc list
toc view 001     # 詳細 + 履歴 + result.md(id は末尾だけで OK)
```

`~/.todo-on-cmux/todo.md` に `- [ ] やること` の行を足すだけでも、次のサイクルで取り込まれます。

## コマンド

| コマンド | 内容 |
|---|---|
| `add <title> [--url <url>]` | タスクを手動追加 |
| `discover` | 有効なアダプタから候補を取得 |
| `list [--status <s>]` | タスク一覧(表) |
| `view <id>` | タスク詳細・状態遷移履歴・`result.md` |
| `plan [<id>]` | pending を分類 → `planned` / `needs_user` |
| `dispatch [<id>]` | planned を cmux で起動 |
| `report` | `result.md` を回収し状態更新、日次レポート作成 |
| `run` | 1サイクル: discover → plan → dispatch → report |
| `loop [--interval <sec>]` | `run` を無限反復(既定 600 秒、cmux 内で実行) |
| `up` | `todo-loop` cmux ワークスペースの生存を保証(冪等) |
| `requeue <id>` | `needs_user`/`blocked`/`failed` → `pending` |
| `done <id>` | `needs_user` タスクを `done` にする |

タスク id は一意なら末尾だけ(`001` や `20260611-001`)で指定できます。

## 分類のしくみ

キーワード分類器(`src/planner.ts`、英/日/韓に対応)が各タスクにモードを割り当てます:

- **`autonomous`** — レビュー・テスト・分析・ビルド・修正・リファクタ: 直接実行。
- **`prepare`** — 会議準備・要約・調査・比較・ドラフト: 調査と下書きのみ。共有状態は変えない。どのキーワードにも当たらないタスクの既定でもあります。
- **`needs_user`** — デプロイ・削除・送信・マージ・権限・シークレット・支払い: **自動実行しない。** 判断のため保留。`requeue` で戻し、`done` で閉じる。

キーワードリストは、実際に使う語彙に合わせて編集してください。

## プロバイダ

config の `provider:` で設定。どちらも **cmux ペイン内の対話型セッション** として動くので、終了後もセッションは開いたままで引き継げます。

| | `claude` | `codex` |
|---|---|---|
| コマンド(auto) | `claude --permission-mode auto …` | `codex --full-auto …` |
| プロンプトなし起動 | `~/.claude.json` に信頼を事前登録 | `~/.codex/config.toml` でベストエフォート |
| 状態 | 検証済み | 実験的 — 無人運用前に要検証 |

`permission: auto` ではエージェントは権限プロンプトなしで動きますが、エージェント自身の分類器が非可逆・破壊的・環境外の操作をブロックします。`permission: prompt` では各操作で承認を求めます(安全だがセッションが止まるため無人不可)。

無人起動で cmux のフォルダ信頼ダイアログを出さないため、ランナーは起動前に各ワークスペースを信頼済みとして事前登録します。Claude では検証済み、Codex ではベストエフォートです。

## 定期実行

cmux ソケットは GUI セッション外(launchd、tmux サーバ)からの接続を拒否します(`Broken pipe`)。そのためディスパッチループは **cmux 内** で動かす必要があります:

```sh
toc up      # `loop --interval 600` を動かす `todo-loop` ワークスペースを開く
```

`up` は毎サイクル heartbeat を書き、冪等です。ループが生きていれば何もせず、再起動後は死んだワークスペースを置き換えます。朝のルーチンとして `toc up` を(cmux を開いた状態で)実行してください。

## データ配置

`~/.todo-on-cmux/`(`TODO_ON_CMUX_HOME` で変更可):

```
config.yaml                                      # config.example.yaml 参照
tasks.db                                         # SQLite: tasks + 状態遷移イベント
todo.md                                          # local_file ソース: "- [ ] ..." 行
workspaces/task-YYYYMMDD-NNN/
  prompt.md  run.sh  result.md  logs/session.log
reports/daily-YYYY-MM-DD.md
```

状態機械(`pending → planned → running → done`、ほか `needs_user` / `blocked` / `failed`)はコードで強制され、全遷移が `events` テーブルに記録されます。

## 安全設計

- 外部送信・デプロイ・削除・権限変更・PR 作成/マージは分類段階でブロック(`needs_user` へ)し、すべての `prompt.md` に制約として明記します。
- 高リスクのタスクは決して自動実行しません。
- `permission: prompt` ではエージェント自身の承認プロンプトが最後のゲート。`permission: auto` ではエージェントの分類器がゲートになります — 有効にする内容を理解し、隔離環境を推奨します。
- トークン/認証情報はエージェントに渡しません。GitHub ソースは `gh` CLI に委譲します。

> auto モードはプロンプトをなくしますが安全性を保証しません。大筋を信頼できるタスクに使い、機密操作のレビューの代わりにはしないでください。

## 拡張

`src/adapters/` の `Adapter` インターフェースを実装し、config の `adapters:` で有効化すればソースを追加できます。OAuth ベースのソース(Google Tasks、Slack など)は当面スコープ外です — サードパーティのトークンを保存しない方針のためです。

## ライセンス

[MIT](./LICENSE)
