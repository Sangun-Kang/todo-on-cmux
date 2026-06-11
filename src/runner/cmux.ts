import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Task } from '../task.js';
import { Config } from '../config.js';
import { getProvider } from './provider.js';

function cmux(args: string[]): string {
  return execFileSync('cmux', args, { encoding: 'utf8' }).trim();
}

export function ping(): boolean {
  try {
    return cmux(['ping']).includes('PONG');
  } catch {
    return false;
  }
}

const BIN = 'toc';

/**
 * Launch an agent session for the task in a new cmux workspace. The session
 * runs interactively in the pane (not headless) so you can read along and
 * resume it after the task finishes. The workspace is pre-trusted so no trust
 * dialog blocks the unattended start; with `permission: auto` the agent runs
 * with no prompts (its own classifier still gates risky actions).
 */
export function launch(task: Task, cfg: Config): string {
  const ws = task.workspacePath!;
  const provider = getProvider(cfg.provider);
  provider.pretrust(ws);

  const runSh = path.join(ws, 'run.sh');
  const agentLine = provider.command(cfg.model, cfg.permission);
  // Tee output to logs/ and guarantee a result.md exists when the agent exits
  // without writing one (e.g. the session is closed early), so the task never
  // gets stuck in `running`. The session itself stays interactive afterward.
  fs.writeFileSync(
    runSh,
    `#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")"
${agentLine} 2>&1 | tee -a logs/session.log
code=\${PIPESTATUS[0]}
if [ ! -f result.md ]; then
  printf 'STATUS: failed\\n\\nsession exited (code %s) without writing result.md. See logs/session.log\\n' "$code" > result.md
fi
`,
    { mode: 0o755 }
  );
  const out = cmux([
    'new-workspace',
    '--name', task.id,
    '--cwd', ws,
    '--command', './run.sh',
  ]);
  // Output looks like "OK workspace:5"; keep just the workspace ref.
  return out.replace(/^OK\s+/, '');
}

/** Find a workspace ref (e.g. "workspace:7") by exact title. */
export function findWorkspace(title: string): string | null {
  let out: string;
  try {
    out = cmux(['list-workspaces']);
  } catch {
    return null;
  }
  for (const line of out.split('\n')) {
    const m = line.match(/^\*?\s*(workspace:\d+)\s+(.+?)(?:\s+\[selected\])?\s*$/);
    if (!m) continue;
    // Busy workspaces get an activity icon prefixed to the title (e.g.
    // "⠂ task-..."), so strip leading non-word symbols before comparing.
    const t = m[2].trim().replace(/^[^\w]+\s*/u, '');
    if (t === title) return m[1];
  }
  return null;
}

export function closeWorkspace(ref: string): void {
  try {
    cmux(['close-workspace', '--workspace', ref]);
  } catch {
    // already gone
  }
}

export function startLoopWorkspace(intervalSec: number): string {
  const out = cmux([
    'new-workspace',
    '--name', 'todo-loop',
    '--command', `${BIN} loop --interval ${intervalSec}`,
  ]);
  return out.replace(/^OK\s+/, '');
}

export function notify(title: string, body: string): void {
  try {
    cmux(['notify', '--title', title, '--body', body]);
  } catch {
    // cmux not running; notification is best-effort
  }
}
