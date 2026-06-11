import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';

export type ProviderName = 'claude' | 'codex';
export type Permission = 'auto' | 'prompt';

export interface Config {
  root: string;
  maxConcurrent: number;
  maxPerRepo: number;
  maxFailures: number;
  provider: ProviderName;
  model: string;
  permission: Permission;
  closeDoneWorkspaces: boolean;
  adapters: Record<string, boolean>;
  safety: {
    allowExternalSend: boolean;
    allowDeploy: boolean;
    allowDelete: boolean;
    allowPrCreate: boolean;
    allowBrowserAutomation: boolean;
    allowReviewComment: boolean;
  };
}

const DEFAULT_FILE = {
  max_concurrent: 2,
  max_per_repo: 1,
  max_failures: 2,
  // Which agent CLI drives each task. `claude` is fully tested; `codex` is
  // supported via the same interactive-session pattern (see README).
  provider: 'claude',
  // Provider-specific model id. claude: sonnet|opus|haiku. codex: e.g. gpt-5-codex.
  model: 'sonnet',
  // auto: the agent runs with its own auto/full-auto permission classifier,
  // no prompts. prompt: the agent keeps asking for approval (safer, but the
  // session blocks on each prompt — not unattended).
  permission: 'auto',
  // Interactive sessions stay open after a task finishes so you can resume
  // them. Set true to auto-close workspaces once a task reports `done`.
  close_done_workspaces: false,
  adapters: {
    local_file: true,
    github: false,
  },
  safety: {
    allow_external_send: false,
    allow_deploy: false,
    allow_delete: false,
    allow_pr_create: false,
    allow_browser_automation: false,
    allow_review_comment: false,
  },
};

export function rootDir(): string {
  return process.env.TODO_ON_CMUX_HOME ?? path.join(os.homedir(), '.todo-on-cmux');
}

export function loadConfig(): Config {
  const root = rootDir();
  fs.mkdirSync(path.join(root, 'workspaces'), { recursive: true });
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });

  const cfgPath = path.join(root, 'config.yaml');
  let raw: any = {};
  if (fs.existsSync(cfgPath)) {
    raw = YAML.parse(fs.readFileSync(cfgPath, 'utf8')) ?? {};
  } else {
    fs.writeFileSync(cfgPath, YAML.stringify(DEFAULT_FILE));
  }
  const merged = { ...DEFAULT_FILE, ...raw };
  const safety = { ...DEFAULT_FILE.safety, ...(raw.safety ?? {}) };
  return {
    root,
    maxConcurrent: merged.max_concurrent,
    maxPerRepo: merged.max_per_repo,
    maxFailures: merged.max_failures,
    provider: merged.provider === 'codex' ? 'codex' : 'claude',
    model: merged.model,
    permission: merged.permission === 'prompt' ? 'prompt' : 'auto',
    closeDoneWorkspaces: Boolean(merged.close_done_workspaces),
    adapters: { ...DEFAULT_FILE.adapters, ...(raw.adapters ?? {}) },
    safety: {
      allowExternalSend: safety.allow_external_send,
      allowDeploy: safety.allow_deploy,
      allowDelete: safety.allow_delete,
      allowPrCreate: safety.allow_pr_create,
      allowBrowserAutomation: safety.allow_browser_automation,
      allowReviewComment: safety.allow_review_comment,
    },
  };
}
