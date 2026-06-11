import { execFileSync } from 'node:child_process';
import { Adapter, Candidate } from './types.js';
import { Config } from '../config.js';

/**
 * Read-only adapter over `gh api notifications`. Requires the gh CLI to be
 * authenticated. Never writes anything to GitHub.
 */
export const githubAdapter: Adapter = {
  name: 'github',
  async discover(_cfg: Config): Promise<Candidate[]> {
    let raw: string;
    try {
      raw = execFileSync('gh', ['api', 'notifications', '--paginate'], { encoding: 'utf8' });
    } catch (e: any) {
      console.error(`[github] gh api notifications failed: ${e.message?.split('\n')[0]}`);
      return [];
    }
    const notifications = JSON.parse(raw || '[]');
    const candidates: Candidate[] = [];
    for (const n of notifications) {
      const repo = n.repository?.full_name ?? 'unknown';
      // API URL -> human URL (https://api.github.com/repos/o/r/pulls/1 -> https://github.com/o/r/pull/1)
      const apiUrl: string | undefined = n.subject?.url;
      const htmlUrl = apiUrl
        ?.replace('api.github.com/repos', 'github.com')
        .replace('/pulls/', '/pull/') ?? null;
      candidates.push({
        title: `[${repo}] ${n.subject?.title ?? '(no title)'} (${n.reason})`,
        source: 'github',
        sourceUrl: htmlUrl,
      });
    }
    return candidates;
  },
};
