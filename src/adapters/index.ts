import { Adapter } from './types.js';
import { localFileAdapter } from './localFile.js';
import { githubAdapter } from './github.js';
import { Config } from '../config.js';

// google_tasks and slack_later are intentionally absent for now: per the
// design doc, OAuth-based sources are out of MVP scope. Add them here as
// new Adapter implementations when ready.
const ALL: Adapter[] = [localFileAdapter, githubAdapter];

export function enabledAdapters(cfg: Config): Adapter[] {
  return ALL.filter((a) => cfg.adapters[a.name]);
}
