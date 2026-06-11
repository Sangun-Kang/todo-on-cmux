#!/usr/bin/env -S node --no-warnings
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from './config.js';
import { TaskQueue } from './queue.js';
import { Task, Status } from './task.js';
import { plan, dispatch } from './dispatcher.js';
import { collect, dailyReport } from './reporter.js';
import { enabledAdapters } from './adapters/index.js';
import * as cmuxRunner from './runner/cmux.js';

const USAGE = `toc (todo-on-cmux): route your TODOs to autonomous agent sessions on cmux

Usage:
  toc add <title> [--url <url>] [--source <source>]   Add a task manually
  toc discover                                        Pull candidates from enabled adapters
  toc list [--status <status>]                        List tasks (markdown table)
  toc view <task-id>                                  Show task detail, events, result
  toc plan [<task-id>]                                Classify pending tasks -> planned
  toc dispatch [<task-id>]                            Launch planned tasks in cmux
  toc report                                          Collect result.md + write daily report
  toc run                                             discover -> plan -> dispatch -> report
  toc loop [--interval <sec>]                         Run forever (default 600s; run inside cmux)
  toc up                                              Ensure the todo-loop cmux workspace is alive
  toc requeue <task-id>                               needs_user/blocked/failed -> pending
  toc done <task-id>                                  Mark a needs_user task as done

Data lives in ~/.todo-on-cmux/ (override with TODO_ON_CMUX_HOME).
(\`toc\` and \`todo-on-cmux\` are the same command.)`;

function fmtTable(tasks: Task[]): string {
  if (!tasks.length) return '(no tasks)';
  const rows = [
    '| id | status | mode | risk | source | title |',
    '|----|--------|------|------|--------|-------|',
  ];
  for (const t of tasks) {
    const title = t.title.length > 60 ? t.title.slice(0, 57) + '...' : t.title;
    rows.push(`| ${t.id} | ${t.status} | ${t.mode ?? '-'} | ${t.risk ?? '-'} | ${t.source} | ${title.replace(/\|/g, '\\|')} |`);
  }
  return rows.join('\n');
}

/** One iteration of the loop: discover -> plan -> dispatch -> report. */
async function runOnce(queue: TaskQueue, cfg: ReturnType<typeof loadConfig>): Promise<void> {
  for (const adapter of enabledAdapters(cfg)) {
    const candidates = await adapter.discover(cfg);
    let added = 0;
    for (const c of candidates) if (queue.add(c.title, c.source, c.sourceUrl)) added++;
    console.log(`[${adapter.name}] +${added} tasks`);
  }
  const planned = plan(queue, cfg);
  console.log(`planned: ${planned.length}`);
  // cmux being unreachable must not kill the iteration: skip dispatch,
  // still collect results and write the report.
  try {
    const d = dispatch(queue, cfg);
    console.log(`launched: ${d.launched.map((t) => t.id).join(', ') || '(none)'}`);
    for (const s of d.skipped) console.log(`skipped ${s.task.id}: ${s.reason}`);
  } catch (e: any) {
    console.error(`dispatch skipped: ${e.message}`);
  }
  const c = collect(queue, cfg);
  for (const u of c.updated) console.log(`${u.task.id} -> ${u.to}`);
  if (c.updated.length) {
    cmuxRunner.notify('todo-on-cmux', c.updated.map((u) => `${u.task.id}: ${u.to}`).join(', '));
  }
  console.log(`daily report: ${dailyReport(queue, cfg)}`);
}

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log(USAGE);
    return 0;
  }

  const cfg = loadConfig();
  const queue = new TaskQueue(cfg.root);

  try {
    switch (cmd) {
      case 'add': {
        const { values, positionals } = parseArgs({
          args: rest,
          options: { url: { type: 'string' }, source: { type: 'string', default: 'manual' } },
          allowPositionals: true,
        });
        const title = positionals.join(' ').trim();
        if (!title) throw new Error('usage: toc add <title> [--url <url>]');
        const task = queue.add(title, values.source as Task['source'], values.url ?? null);
        if (!task) {
          console.log('duplicate task, skipped');
          return 0;
        }
        console.log(`added ${task.id}: ${task.title}`);
        return 0;
      }

      case 'discover': {
        let added = 0, dup = 0;
        for (const adapter of enabledAdapters(cfg)) {
          const candidates = await adapter.discover(cfg);
          for (const c of candidates) {
            const task = queue.add(c.title, c.source, c.sourceUrl);
            task ? added++ : dup++;
          }
          console.log(`[${adapter.name}] ${candidates.length} candidates`);
        }
        console.log(`added ${added}, skipped ${dup} duplicates`);
        return 0;
      }

      case 'list': {
        const { values } = parseArgs({
          args: rest,
          options: { status: { type: 'string' } },
          allowPositionals: true,
        });
        console.log(fmtTable(queue.list(values.status as Status | undefined)));
        return 0;
      }

      case 'view': {
        const id = rest[0];
        if (!id) throw new Error('usage: toc view <task-id>');
        const task = queue.get(id);
        if (!task) throw new Error(`task not found: ${id}`);
        console.log(`# ${task.id}`);
        console.log(`- title: ${task.title}`);
        console.log(`- status: ${task.status} / mode: ${task.mode ?? '-'} / risk: ${task.risk ?? '-'}`);
        console.log(`- source: ${task.source} ${task.sourceUrl ?? ''}`);
        if (task.repo) console.log(`- repo: ${task.repo}`);
        if (task.workspacePath) console.log(`- workspace: ${task.workspacePath}`);
        if (task.runnerRef) console.log(`- runner: ${task.runnerRef}`);
        console.log(`- failures: ${task.failCount}`);
        console.log('\n## events');
        for (const e of queue.events(task.id)) {
          console.log(`- ${e.at} ${e.from_status ?? '(new)'} -> ${e.to_status}${e.note ? ` (${e.note})` : ''}`);
        }
        const resultPath = task.workspacePath ? path.join(task.workspacePath, 'result.md') : null;
        if (resultPath && fs.existsSync(resultPath)) {
          console.log('\n## result.md\n');
          console.log(fs.readFileSync(resultPath, 'utf8'));
        }
        return 0;
      }

      case 'plan': {
        const planned = plan(queue, cfg, rest[0]);
        for (const t of planned) {
          console.log(`${t.id} -> ${t.status} (mode: ${t.mode}, risk: ${t.risk})`);
        }
        if (!planned.length) console.log('no pending tasks');
        return 0;
      }

      case 'dispatch': {
        const r = dispatch(queue, cfg, rest[0]);
        for (const t of r.launched) console.log(`launched ${t.id} in cmux workspace "${t.id}"`);
        for (const s of r.skipped) console.log(`skipped ${s.task.id}: ${s.reason}`);
        if (!r.launched.length && !r.skipped.length) console.log('no planned tasks');
        return 0;
      }

      case 'report': {
        const c = collect(queue, cfg);
        for (const u of c.updated) console.log(`${u.task.id} -> ${u.to}`);
        for (const t of c.stillRunning) console.log(`${t.id} still running (no result.md yet)`);
        const reportPath = dailyReport(queue, cfg);
        console.log(`daily report: ${reportPath}`);
        if (c.updated.length) {
          cmuxRunner.notify('todo-on-cmux', c.updated.map((u) => `${u.task.id}: ${u.to}`).join(', '));
        }
        return 0;
      }

      case 'run': {
        await runOnce(queue, cfg);
        return 0;
      }

      case 'loop': {
        // Meant to run inside a cmux workspace: processes outside the GUI
        // session (launchd, tmux server) cannot reach the cmux socket.
        const { values } = parseArgs({
          args: rest,
          options: { interval: { type: 'string', default: '600' } },
          allowPositionals: true,
        });
        const intervalSec = Number(values.interval);
        if (!Number.isFinite(intervalSec) || intervalSec < 10) {
          throw new Error('usage: toc loop [--interval <seconds>=600]');
        }
        for (;;) {
          console.log(`\n=== ${new Date().toLocaleString()} ===`);
          fs.writeFileSync(path.join(cfg.root, 'loop.heartbeat'), new Date().toISOString());
          try {
            await runOnce(queue, cfg);
          } catch (e: any) {
            console.error(`iteration failed: ${e.message}`);
          }
          await new Promise((r) => setTimeout(r, intervalSec * 1000));
        }
      }

      case 'up': {
        // Morning routine: make sure the todo-loop workspace is alive.
        const intervalSec = 600;
        const hbPath = path.join(cfg.root, 'loop.heartbeat');
        if (fs.existsSync(hbPath)) {
          const age = (Date.now() - fs.statSync(hbPath).mtimeMs) / 1000;
          if (age < intervalSec * 2) {
            console.log(`loop is alive (last heartbeat ${Math.round(age)}s ago)`);
            return 0;
          }
        }
        if (!cmuxRunner.ping()) {
          throw new Error('cmux is not reachable. Open cmux.app first, then run `todo up` again.');
        }
        // A restored-but-dead workspace may linger after a reboot; replace it.
        const stale = cmuxRunner.findWorkspace('todo-loop');
        if (stale) {
          console.log(`closing stale todo-loop workspace (${stale})`);
          cmuxRunner.closeWorkspace(stale);
        }
        const ref = cmuxRunner.startLoopWorkspace(intervalSec);
        console.log(`started todo-loop in cmux (${ref})`);
        return 0;
      }

      case 'requeue': {
        const id = rest[0];
        if (!id) throw new Error('usage: toc requeue <task-id>');
        const t = queue.transition(queue.get(id)?.id ?? id, 'pending', 'requeued by user');
        console.log(`${t.id} -> pending`);
        return 0;
      }

      case 'done': {
        const id = rest[0];
        if (!id) throw new Error('usage: toc done <task-id>');
        const t = queue.transition(queue.get(id)?.id ?? id, 'done', 'resolved by user');
        console.log(`${t.id} -> done`);
        return 0;
      }

      default:
        console.error(`unknown command: ${cmd}\n`);
        console.log(USAGE);
        return 1;
    }
  } finally {
    queue.close();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
);
