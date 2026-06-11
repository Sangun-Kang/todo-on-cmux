import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { Task, Status, canTransition, dedupeKeyFor, extractRepo } from './task.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  source_url TEXT,
  status TEXT NOT NULL,
  mode TEXT,
  risk TEXT,
  repo TEXT,
  workspace_path TEXT,
  runner_ref TEXT,
  fail_count INTEGER NOT NULL DEFAULT 0,
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  note TEXT,
  at TEXT NOT NULL
);
`;

function rowToTask(r: any): Task {
  return {
    id: r.id,
    title: r.title,
    source: r.source,
    sourceUrl: r.source_url,
    status: r.status,
    mode: r.mode,
    risk: r.risk,
    repo: r.repo,
    workspacePath: r.workspace_path,
    runnerRef: r.runner_ref,
    failCount: Number(r.fail_count),
    dedupeKey: r.dedupe_key,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class TaskQueue {
  private db: DatabaseSync;

  constructor(root: string) {
    this.db = new DatabaseSync(path.join(root, 'tasks.db'));
    this.db.exec(SCHEMA);
  }

  private now(): string {
    return new Date().toISOString();
  }

  nextId(): string {
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM tasks WHERE id LIKE ?`)
      .get(`task-${stamp}-%`) as any;
    return `task-${stamp}-${String(Number(row.n) + 1).padStart(3, '0')}`;
  }

  /** Returns the new task, or null if it was a duplicate. */
  add(title: string, source: Task['source'], sourceUrl: string | null): Task | null {
    const dedupeKey = dedupeKeyFor(title, source, sourceUrl);
    const dup = this.db.prepare(`SELECT id FROM tasks WHERE dedupe_key = ?`).get(dedupeKey);
    if (dup) return null;

    const now = this.now();
    const task: Task = {
      id: this.nextId(),
      title,
      source,
      sourceUrl,
      status: 'pending',
      mode: null,
      risk: null,
      repo: extractRepo(sourceUrl),
      workspacePath: null,
      runnerRef: null,
      failCount: 0,
      dedupeKey,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO tasks (id, title, source, source_url, status, mode, risk, repo, workspace_path, runner_ref, fail_count, dedupe_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        task.id, task.title, task.source, task.sourceUrl, task.status,
        task.mode, task.risk, task.repo, task.workspacePath, task.runnerRef,
        task.failCount, task.dedupeKey, task.createdAt, task.updatedAt
      );
    this.logEvent(task.id, null, 'pending', `created from ${source}`);
    return task;
  }

  get(id: string): Task | null {
    // Allow suffix match: "001" or "20260611-001" resolves to the full id.
    let row = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as any;
    if (!row) {
      const rows = this.db.prepare(`SELECT * FROM tasks WHERE id LIKE ?`).all(`task-%${id}`) as any[];
      if (rows.length === 1) row = rows[0];
    }
    return row ? rowToTask(row) : null;
  }

  list(status?: Status): Task[] {
    const rows = status
      ? (this.db.prepare(`SELECT * FROM tasks WHERE status = ? ORDER BY created_at`).all(status) as any[])
      : (this.db.prepare(`SELECT * FROM tasks ORDER BY created_at`).all() as any[]);
    return rows.map(rowToTask);
  }

  transition(id: string, to: Status, note?: string): Task {
    const task = this.get(id);
    if (!task) throw new Error(`task not found: ${id}`);
    if (!canTransition(task.status, to)) {
      throw new Error(`invalid transition for ${task.id}: ${task.status} -> ${to}`);
    }
    this.db
      .prepare(`UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?`)
      .run(to, this.now(), task.id);
    this.logEvent(task.id, task.status, to, note ?? null);
    return { ...task, status: to };
  }

  update(id: string, fields: Partial<Pick<Task, 'mode' | 'risk' | 'workspacePath' | 'runnerRef' | 'failCount'>>): void {
    const sets: string[] = [];
    const vals: any[] = [];
    if (fields.mode !== undefined) { sets.push('mode = ?'); vals.push(fields.mode); }
    if (fields.risk !== undefined) { sets.push('risk = ?'); vals.push(fields.risk); }
    if (fields.workspacePath !== undefined) { sets.push('workspace_path = ?'); vals.push(fields.workspacePath); }
    if (fields.runnerRef !== undefined) { sets.push('runner_ref = ?'); vals.push(fields.runnerRef); }
    if (fields.failCount !== undefined) { sets.push('fail_count = ?'); vals.push(fields.failCount); }
    if (!sets.length) return;
    sets.push('updated_at = ?');
    vals.push(this.now(), id);
    this.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }

  events(taskId: string): any[] {
    return this.db.prepare(`SELECT * FROM events WHERE task_id = ? ORDER BY seq`).all(taskId) as any[];
  }

  private logEvent(taskId: string, from: Status | null, to: Status, note: string | null): void {
    this.db
      .prepare(`INSERT INTO events (task_id, from_status, to_status, note, at) VALUES (?, ?, ?, ?, ?)`)
      .run(taskId, from, to, note, this.now());
  }

  close(): void {
    this.db.close();
  }
}
