export type Status =
  | 'pending'
  | 'planned'
  | 'running'
  | 'done'
  | 'needs_user'
  | 'blocked'
  | 'failed';

export type Mode = 'autonomous' | 'prepare' | 'needs_user';
export type Risk = 'low' | 'medium' | 'high';
export type Source = 'manual' | 'google_tasks' | 'slack_later' | 'github' | 'local_file' | 'mock';

export interface Task {
  id: string;
  title: string;
  source: Source;
  sourceUrl: string | null;
  status: Status;
  mode: Mode | null;
  risk: Risk | null;
  repo: string | null;
  workspacePath: string | null;
  runnerRef: string | null;
  failCount: number;
  dedupeKey: string;
  createdAt: string;
  updatedAt: string;
}

// State machine from the design doc (§5)
export const TRANSITIONS: Record<Status, Status[]> = {
  pending: ['planned'],
  planned: ['running', 'needs_user', 'blocked'],
  running: ['done', 'blocked', 'failed', 'needs_user'],
  done: [],
  needs_user: ['pending', 'done'],
  blocked: ['pending'],
  failed: ['pending', 'blocked'],
};

export function canTransition(from: Status, to: Status): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function extractRepo(sourceUrl: string | null): string | null {
  if (!sourceUrl) return null;
  const m = sourceUrl.match(/https?:\/\/[^/]+\/([^/]+\/[^/]+)\/(?:pull|issues|commit|tree|blob)/);
  return m ? m[1] : null;
}

export function dedupeKeyFor(title: string, source: string, sourceUrl: string | null): string {
  if (sourceUrl) return `${source}:${sourceUrl}`;
  const normalized = title.trim().toLowerCase().replace(/\s+/g, ' ');
  return `${source}:title:${normalized}`;
}
