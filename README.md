# todo-on-cmux

Route your scattered TODOs to autonomous agent sessions running in parallel on [cmux](https://cmux.io).

`todo-on-cmux` collects TODOs from several sources, classifies each by how safe it is to run, and dispatches the safe ones to **interactive [Claude Code](https://claude.com/claude-code) or [Codex](https://github.com/openai/codex) sessions inside cmux workspaces**. Each session does as much as it safely can, writes a `result.md`, and stays open so you can read along or take over. Risky tasks (deploy, delete, external sends, PR merges) are held back for you to decide.

> Languages: **English** · [日本語](./README.ja.md)

```
sources ──► queue ──► classify ──► dispatch ──► agent session ──► result.md ──► report
(add / todo.md      (SQLite)    (auto/prepare/   (cmux pane,
 / GitHub)                       needs_user)      Claude or Codex)
```

## Why

Inspired by the idea of an autonomous agent acting as a "first responder" to your inbox of small tasks. Instead of replacing a task manager, it turns scattered signals — a manual note, a `todo.md` line, a GitHub notification — into a queue an agent can actually work through, while keeping a hard line between *"looks doable"* and *"safe to do unattended."*

## Requirements

- **macOS** with [cmux](https://cmux.io) installed and running (the runner drives cmux workspaces).
- **Node.js ≥ 22** (uses the built-in `node:sqlite`).
- An agent CLI on your `PATH`:
  - **[Claude Code](https://claude.com/claude-code)** (`claude`) — fully tested. Auto permission mode needs Claude Code ≥ 2.1.83 and a model that supports it (e.g. Sonnet 4.6).
  - or **[Codex](https://github.com/openai/codex)** (`codex`) — supported via the same pattern; experimental, verify in your environment.
- *(optional)* an authenticated **`gh` CLI** for the GitHub source.

## Install

```sh
git clone https://github.com/Sangun-Kang/todo-on-cmux.git
cd todo-on-cmux
npm install
npm run build
npm link          # puts `toc` (and `todo-on-cmux`) on your PATH
toc help
```


## Quickstart

```sh
# 1. Add a task (URL goes in --url so dedup and per-repo limits work)
toc add "Review PR and summarize risks" --url https://github.com/you/repo/pull/42

# 2. Run one cycle: collect -> classify -> dispatch -> report
toc run

# 3. A cmux workspace opens and an agent works the task. Watch it, then:
toc list
toc view 001     # detail + events + result.md (id suffix is enough)
```

You can also just add `- [ ] something to do` lines to `~/.todo-on-cmux/todo.md`; they're picked up on the next cycle.

## Commands

| Command | What it does |
|---|---|
| `add <title> [--url <url>]` | Add a task manually |
| `discover` | Pull candidates from enabled adapters |
| `list [--status <s>]` | List tasks as a table |
| `view <id>` | Task detail, state-transition history, and `result.md` |
| `plan [<id>]` | Classify pending tasks → `planned` / `needs_user` |
| `dispatch [<id>]` | Launch planned tasks in cmux |
| `report` | Collect `result.md` files, update status, write the daily report |
| `run` | One full cycle: discover → plan → dispatch → report |
| `loop [--interval <sec>]` | Repeat `run` forever (default 600s; run inside cmux) |
| `up` | Ensure the `todo-loop` cmux workspace is alive (idempotent) |
| `requeue <id>` | `needs_user`/`blocked`/`failed` → `pending` |
| `done <id>` | Mark a `needs_user` task as `done` |

Task ids may be given as a suffix (`001` or `20260611-001`) when unambiguous.

## How tasks are classified

A keyword classifier (`src/planner.ts`, covering English/Japanese/Korean) assigns each task a mode:

- **`autonomous`** — review, test, analyze, build, fix, refactor: run it directly.
- **`prepare`** — meeting prep, summary, research, compare, draft: only investigate and draft; never change shared state. This is also the default for tasks no keyword matches.
- **`needs_user`** — deploy, delete, send, merge, permissions, secrets, payment: **never auto-dispatched.** Held for your decision; `requeue` to release, `done` to close.

Edit the keyword lists to match the vocabulary your tasks use.

## Providers

Set `provider:` in config. Both run as **interactive sessions in a cmux pane**, so a finished session stays open for follow-up.

| | `claude` | `codex` |
|---|---|---|
| Command (auto) | `claude --permission-mode auto …` | `codex --full-auto …` |
| No-prompt start | trust pre-registered in `~/.claude.json` | best-effort via `~/.codex/config.toml` |
| Status | fully tested | experimental — verify before unattended use |

With `permission: auto`, the agent runs without permission prompts, but its own classifier still blocks irreversible / destructive / out-of-environment actions. With `permission: prompt`, the agent asks for approval on each action (safe, but the session blocks — not unattended).

To skip the cmux folder-trust dialog on an unattended start, the runner pre-registers each workspace as trusted before launching. For Claude this is verified; for Codex it's best-effort.

## Running periodically

The cmux socket rejects connections from outside the GUI session (launchd agents, tmux servers get a `Broken pipe`), so the dispatch loop must run **inside cmux**:

```sh
toc up      # opens a `todo-loop` cmux workspace running `loop --interval 600`
```

`up` writes a heartbeat each cycle and is idempotent: if the loop is alive it's a no-op, and after a reboot it replaces the dead workspace. Make `toc up` your morning routine (cmux must be open).

## Data layout

`~/.todo-on-cmux/` (override with `TODO_ON_CMUX_HOME`):

```
config.yaml                                      # see config.example.yaml
tasks.db                                         # SQLite: tasks + state-transition events
todo.md                                          # local_file source: "- [ ] ..." lines
workspaces/task-YYYYMMDD-NNN/
  prompt.md  run.sh  result.md  logs/session.log
reports/daily-YYYY-MM-DD.md
```

The state machine (`pending → planned → running → done`, plus `needs_user` / `blocked` / `failed`) is enforced in code and every transition is logged to the `events` table.

## Safety model

- External sends, deploys, deletes, permission changes, and PR create/merge are blocked at classification (routed to `needs_user`) and restated as constraints in every `prompt.md`.
- High-risk tasks are never auto-dispatched.
- With `permission: prompt`, the agent's own approval prompts are the final gate. With `permission: auto`, the agent's classifier is the gate — review what you enable, and prefer isolated environments.
- Tokens/credentials are never handed to the agent; the GitHub source delegates to the `gh` CLI.

> Auto mode eliminates prompts but does not guarantee safety. Use it for tasks where you trust the general direction, not as a substitute for reviewing sensitive operations.

## Extending

Add a source by implementing the `Adapter` interface in `src/adapters/` and toggling it under `adapters:` in config. OAuth-based sources (Google Tasks, Slack, etc.) are intentionally out of scope for now — the project avoids storing third-party tokens.

## License

[MIT](./LICENSE)
