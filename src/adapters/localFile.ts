import fs from 'node:fs';
import path from 'node:path';
import { Adapter, Candidate } from './types.js';
import { Config } from '../config.js';

/**
 * Reads unchecked items (`- [ ] ...`) from ~/.todo-on-cmux/todo.md.
 * Lines may carry a URL anywhere in the text; the first URL becomes source_url.
 */
export const localFileAdapter: Adapter = {
  name: 'local_file',
  async discover(cfg: Config): Promise<Candidate[]> {
    const todoPath = path.join(cfg.root, 'todo.md');
    if (!fs.existsSync(todoPath)) return [];

    const candidates: Candidate[] = [];
    for (const line of fs.readFileSync(todoPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*-\s*\[\s\]\s+(.+)$/);
      if (!m) continue;
      const text = m[1].trim();
      const url = text.match(/https?:\/\/\S+/)?.[0] ?? null;
      candidates.push({ title: text, source: 'local_file', sourceUrl: url });
    }
    return candidates;
  },
};
