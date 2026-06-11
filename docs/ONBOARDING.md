# Onboarding guide (AI-readable)

> **This file is meant to be read by an AI coding agent (Claude Code / Codex).**
> A new user can open this repo in their agent and say: *"Read docs/ONBOARDING.md and set this up for me."*
> For a human overview see [../README.md](../README.md) (English) or [../README.ja.md](../README.ja.md) (日本語).

## What this is

`todo-on-cmux` collects TODOs, classifies them by safety, and dispatches the safe ones to interactive Claude Code / Codex sessions inside cmux workspaces. Pipeline:

```
collect (adapters) -> queue (SQLite) -> classify (planner) -> dispatch (cmux session) -> result.md -> report
```

## Setup steps for the agent

Run these in order. If a check fails, stop and report it to the user rather than guessing.

### 1. Verify prerequisites

```sh
sw_vers                 # macOS (cmux is a macOS app)
node --version          # >= 22 (uses node:sqlite)
cmux ping               # expect "PONG"; if not, the user must launch cmux.app
# one agent CLI must exist:
claude --version        # Claude Code (default provider), OR
codex --version         # Codex (set provider: codex in config)
gh auth status          # only if the user wants the github source (GH_HOST for GHES)
```

- No cmux → install from https://cmux.io. Without it, `dispatch` cannot run, but `add`/`list`/`plan`/`report` still work.
- Node < 22 → install 22+ via nodenv/nvm/etc.

### 2. Build and install

```sh
npm install
npm run build
npm link                # puts `toc` on PATH
toc help
```

### 3. Initialize config

```sh
toc list       # first run creates ~/.todo-on-cmux/ and config.yaml
```

Then review `~/.todo-on-cmux/config.yaml` against `config.example.yaml`. Key fields:

| key | default | note |
|---|---|---|
| `provider` | claude | `claude` (tested) or `codex` (experimental) |
| `model` | sonnet | runs unattended and burns tokens — pick a cost-effective model |
| `permission` | auto | `auto` (no prompts, classifier gates risk) or `prompt` (asks each time) |
| `adapters.local_file` | true | reads `~/.todo-on-cmux/todo.md` |
| `adapters.github` | false | `gh api notifications` (read-only) |
| `safety.allow_review_comment` | false | true lets review tasks post PR comments |

### 4. Smoke test (no real tokens)

Use a fake agent command that just writes a `result.md`, in an isolated home:

```sh
export TODO_ON_CMUX_HOME=/tmp/toc-smoke
mkdir -p $TODO_ON_CMUX_HOME
cat > /tmp/fake-agent.sh <<'EOF'
#!/usr/bin/env bash
printf 'STATUS: done\n\nsmoke test passed\n' > result.md
sleep 2
EOF
chmod +x /tmp/fake-agent.sh
# Temporarily make the provider command the fake script by aliasing `claude`:
# (or just exercise the non-dispatch path:)
toc add "smoke test: organize docs"
toc plan        # -> planned (autonomous or prepare)
toc list

# cleanup
unset TODO_ON_CMUX_HOME
rm -rf /tmp/toc-smoke /tmp/fake-agent.sh
```

To smoke-test dispatch end to end, run `toc dispatch` with cmux open and watch the workspace, then `toc report`.

### 5. Start the periodic loop

```sh
toc up    # opens a `todo-loop` cmux workspace running loop --interval 600
```

**Important constraint**: the cmux socket rejects clients outside the GUI session (launchd, tmux server → `Broken pipe`), so the loop must run inside cmux. `toc up` does this and is idempotent (no-op if the heartbeat is fresh, replaces a dead workspace after reboot).

## Daily use

```sh
toc add "Review PR and summarize risks" --url https://github.com/you/repo/pull/42
# or add "- [ ] ..." lines to ~/.todo-on-cmux/todo.md
toc list
toc view 001
toc requeue 001   # release a needs_user/blocked task
```

- Always pass URLs via `--url` (dedup and per-repo limits key on source_url).
- Tasks matching deploy/delete/send/merge/permission/secret keywords are routed to `needs_user` and never auto-dispatched.

## Safety model (confirm with the user before changing)

- External sends, deploy, delete, permission changes, PR create/merge are forbidden in the prompt and quarantined to `needs_user` by the classifier.
- `permission: prompt` keeps the agent's approval prompts as the final gate; `permission: auto` relies on the agent's own classifier. Prefer starting with `prompt` to observe behavior, then switch.
- Tokens are never handed to the agent; GitHub access is delegated to `gh`.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `cmux is not reachable` | cmux.app not running, or invoked via launchd/tmux. Run from inside cmux or a normal terminal. |
| dispatched session can't read a PR | check `gh auth status` for the target host (GHES: set `GH_HOST`) |
| same task dispatched twice | multiple loops running. Use `toc up` only; don't start `loop` by hand. |
| task stuck in `running` | the session exited without a `result.md`; `run.sh` writes a `failed` result on exit, so run `report` to collect it. |
