import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProviderName, Permission } from '../config.js';

export interface Provider {
  name: ProviderName;
  /**
   * The shell command that launches the agent interactively in the workspace
   * directory, reading the task from `prompt.md`. Runs inside a cmux pane so
   * the session stays open for follow-up after the task finishes.
   */
  command(model: string, permission: Permission): string;
  /**
   * Best-effort: mark `workspacePath` as trusted so no "do you trust this
   * folder?" dialog blocks an unattended start. Safe to call repeatedly.
   */
  pretrust(workspacePath: string): void;
}

function realpath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

// Claude Code stores per-directory trust in ~/.claude.json under
// projects[absolutePath].hasTrustDialogAccepted. Pre-seeding that entry skips
// the trust dialog. We merge into the existing entry to avoid clobbering
// settings Claude Code manages itself.
const claudeProvider: Provider = {
  name: 'claude',
  command(model, permission) {
    const base = `claude --model ${model}`;
    return permission === 'auto'
      ? `${base} --permission-mode auto "$(cat prompt.md)"`
      : `${base} "$(cat prompt.md)"`;
  },
  pretrust(workspacePath) {
    const file = path.join(os.homedir(), '.claude.json');
    let cfg: any = {};
    try {
      cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      // first run or missing file: start fresh
    }
    cfg.projects = cfg.projects ?? {};
    const key = realpath(workspacePath);
    const existing = cfg.projects[key] ?? {};
    cfg.projects[key] = {
      allowedTools: [],
      ...existing,
      hasTrustDialogAccepted: true,
      projectOnboardingSeenCount: Math.max(1, existing.projectOnboardingSeenCount ?? 0),
    };
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  },
};

// Codex CLI uses an interactive TUI like Claude Code. `--full-auto` is its
// no-prompt mode (workspace-write sandbox + auto approvals). Codex tracks
// trusted projects in ~/.codex/config.toml; pre-seeding it is best-effort and
// version-dependent, so failures are swallowed. Codex support is experimental
// — verify in your environment before relying on it unattended (see README).
const codexProvider: Provider = {
  name: 'codex',
  command(model, permission) {
    const base = model ? `codex --model ${model}` : 'codex';
    return permission === 'auto'
      ? `${base} --full-auto "$(cat prompt.md)"`
      : `${base} "$(cat prompt.md)"`;
  },
  pretrust(workspacePath) {
    try {
      const dir = path.join(os.homedir(), '.codex');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'config.toml');
      const key = realpath(workspacePath);
      const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      if (existing.includes(`[projects."${key}"]`)) return;
      const block = `\n[projects."${key}"]\ntrust_level = "trusted"\n`;
      fs.appendFileSync(file, block);
    } catch {
      // best-effort; codex will fall back to its own trust prompt
    }
  },
};

export function getProvider(name: ProviderName): Provider {
  return name === 'codex' ? codexProvider : claudeProvider;
}
