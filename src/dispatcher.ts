import fs from 'node:fs';
import path from 'node:path';
import { Task } from './task.js';
import { Config } from './config.js';
import { TaskQueue } from './queue.js';
import { classify, buildPrompt } from './planner.js';
import * as cmuxRunner from './runner/cmux.js';

/** Classify pending tasks and move them to planned (or needs_user). */
export function plan(queue: TaskQueue, cfg: Config, taskId?: string): Task[] {
  const targets = taskId
    ? [queue.get(taskId)].filter((t): t is Task => t !== null && t.status === 'pending')
    : queue.list('pending');

  const planned: Task[] = [];
  for (const task of targets) {
    const c = classify(task);
    queue.update(task.id, { mode: c.mode, risk: c.risk });
    let t = queue.transition(task.id, 'planned', c.reason);
    if (c.mode === 'needs_user') {
      t = queue.transition(task.id, 'needs_user', 'high-risk task requires user decision');
    }
    planned.push({ ...t, mode: c.mode, risk: c.risk });
  }
  return planned;
}

export interface DispatchResult {
  launched: Task[];
  skipped: { task: Task; reason: string }[];
}

/** Pick eligible planned tasks, create workspaces, and hand them to the runner. */
export function dispatch(queue: TaskQueue, cfg: Config, taskId?: string): DispatchResult {
  const running = queue.list('running');
  const runningRepos = new Map<string, number>();
  for (const t of running) {
    if (t.repo) runningRepos.set(t.repo, (runningRepos.get(t.repo) ?? 0) + 1);
  }

  const candidates = taskId
    ? [queue.get(taskId)].filter((t): t is Task => t !== null && t.status === 'planned')
    : queue.list('planned');

  const result: DispatchResult = { launched: [], skipped: [] };
  let slots = cfg.maxConcurrent - running.length;

  if (!cmuxRunner.ping()) {
    throw new Error(
      'cmux is not reachable (cmux ping failed). Note: the cmux socket rejects ' +
      'clients outside the GUI session (launchd, tmux server) — run this inside cmux.'
    );
  }

  for (const task of candidates) {
    if (slots <= 0) {
      result.skipped.push({ task, reason: `concurrency limit reached (${cfg.maxConcurrent})` });
      continue;
    }
    if (task.risk === 'high') {
      result.skipped.push({ task, reason: 'high-risk tasks are never auto-dispatched' });
      continue;
    }
    if (task.failCount >= cfg.maxFailures) {
      queue.transition(task.id, 'blocked', `failed ${task.failCount} times`);
      result.skipped.push({ task, reason: `blocked after ${task.failCount} failures` });
      continue;
    }
    if (task.repo && (runningRepos.get(task.repo) ?? 0) >= cfg.maxPerRepo) {
      result.skipped.push({ task, reason: `repo ${task.repo} already has a running task` });
      continue;
    }

    const ws = path.join(cfg.root, 'workspaces', task.id);
    fs.mkdirSync(path.join(ws, 'logs'), { recursive: true });
    const c = { mode: task.mode!, risk: task.risk!, reason: '' };
    fs.writeFileSync(
      path.join(ws, 'prompt.md'),
      buildPrompt(task, c, { allowReviewComment: cfg.safety.allowReviewComment })
    );
    queue.update(task.id, { workspacePath: ws });

    const ref = cmuxRunner.launch({ ...task, workspacePath: ws }, cfg);
    queue.update(task.id, { runnerRef: ref });
    const launched = queue.transition(task.id, 'running', `dispatched to cmux: ${ref}`);

    if (task.repo) runningRepos.set(task.repo, (runningRepos.get(task.repo) ?? 0) + 1);
    slots--;
    result.launched.push(launched);
  }
  return result;
}
