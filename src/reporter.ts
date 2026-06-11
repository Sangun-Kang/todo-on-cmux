import fs from 'node:fs';
import path from 'node:path';
import { Task, Status } from './task.js';
import { Config } from './config.js';
import { TaskQueue } from './queue.js';
import * as cmuxRunner from './runner/cmux.js';

const RESULT_STATUSES: Status[] = ['done', 'needs_user', 'blocked', 'failed'];

function parseResultStatus(resultPath: string): Status | null {
  if (!fs.existsSync(resultPath)) return null;
  const firstLines = fs.readFileSync(resultPath, 'utf8').split('\n').slice(0, 5);
  for (const line of firstLines) {
    const m = line.match(/^STATUS:\s*(\w+)/i);
    if (m && RESULT_STATUSES.includes(m[1].toLowerCase() as Status)) {
      return m[1].toLowerCase() as Status;
    }
  }
  return null;
}

export interface CollectResult {
  updated: { task: Task; to: Status }[];
  stillRunning: Task[];
}

/** Scan running tasks for result.md and apply the reported status. */
export function collect(queue: TaskQueue, cfg: Config): CollectResult {
  const result: CollectResult = { updated: [], stillRunning: [] };
  for (const task of queue.list('running')) {
    const resultPath = task.workspacePath ? path.join(task.workspacePath, 'result.md') : null;
    const status = resultPath ? parseResultStatus(resultPath) : null;
    if (!status) {
      result.stillRunning.push(task);
      continue;
    }
    if (status === 'failed') {
      queue.update(task.id, { failCount: task.failCount + 1 });
    }
    const updated = queue.transition(task.id, status, 'reported via result.md');
    result.updated.push({ task: updated, to: status });
    // By default interactive sessions stay open so you can resume them.
    // With close_done_workspaces, done tasks' panes are closed automatically
    // (result.md and logs/ remain on disk regardless).
    if (status === 'done' && cfg.closeDoneWorkspaces) {
      const ref = cmuxRunner.findWorkspace(task.id);
      if (ref) cmuxRunner.closeWorkspace(ref);
    }
  }
  return result;
}

/** Write reports/daily-YYYY-MM-DD.md summarizing today's activity. */
export function dailyReport(queue: TaskQueue, cfg: Config): string {
  const today = new Date().toISOString().slice(0, 10);
  const tasks = queue.list();
  const touchedToday = tasks.filter((t) => t.updatedAt.startsWith(today));

  const byStatus = new Map<Status, Task[]>();
  for (const t of touchedToday) {
    if (!byStatus.has(t.status)) byStatus.set(t.status, []);
    byStatus.get(t.status)!.push(t);
  }

  const lines: string[] = [`# Daily Report ${today}`, ''];
  lines.push(`- total tasks: ${tasks.length}`);
  lines.push(`- touched today: ${touchedToday.length}`);
  lines.push('');

  const order: Status[] = ['done', 'needs_user', 'running', 'blocked', 'failed', 'planned', 'pending'];
  for (const status of order) {
    const group = byStatus.get(status);
    if (!group?.length) continue;
    lines.push(`## ${status} (${group.length})`);
    lines.push('');
    for (const t of group) {
      lines.push(`- **${t.id}** ${t.title}`);
      if (t.sourceUrl) lines.push(`  - ${t.sourceUrl}`);
      const resultPath = t.workspacePath ? path.join(t.workspacePath, 'result.md') : null;
      if (resultPath && fs.existsSync(resultPath)) {
        lines.push(`  - result: ${resultPath}`);
      }
    }
    lines.push('');
  }

  const reportPath = path.join(cfg.root, 'reports', `daily-${today}.md`);
  fs.writeFileSync(reportPath, lines.join('\n'));
  return reportPath;
}
