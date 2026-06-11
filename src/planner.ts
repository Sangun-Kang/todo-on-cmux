import { Task, Mode, Risk } from './task.js';

// Keyword classification rules. Keywords cover English, Japanese, and Korean
// since task titles can arrive in any of them. Extend these lists to match the
// vocabulary your tasks actually use.

const NEEDS_USER_KEYWORDS = [
  // external sends
  'send', 'slack', 'メール', '메일', 'email', '전송', '送信', 'reply', '답장', '返信',
  // deploy / infra
  'deploy', '배포', 'デプロイ', 'release', '릴리스', 'リリース',
  // destructive
  'delete', '삭제', '削除', 'drop', 'remove', 'rm -',
  // permissions / secrets
  '권한', '権限', 'permission', 'token', '토큰', 'secret', '시크릿', 'credential', '인증',
  // irreversible VCS / money
  'merge', '머지', 'マージ', 'force push', '결제', '支払', 'payment', 'purchase', '구매',
];

const PREPARE_KEYWORDS = [
  '회의', '미팅', 'meeting', 'ミーティング', '会議', '준비', '準備', 'prepare',
  '요약', '要約', 'summary', 'summarize', '정리', '整理',
  '조사', '調査', 'research', 'investigate', '검토', '検討',
  '비교', '比較', 'compare', '계획', '計画', 'plan', '초안', 'draft', 'ドラフト',
];

const AUTONOMOUS_KEYWORDS = [
  '리뷰', 'review', 'レビュー', '테스트', 'test', 'テスト',
  '분석', '分析', 'analyze', 'lint', '빌드', 'build', 'ビルド',
  '버그', 'bug', 'バグ', 'fix', '수정', '修正', 'refactor', '리팩터',
];

function matches(text: string, keywords: string[]): string | null {
  const lower = text.toLowerCase();
  for (const kw of keywords) {
    if (lower.includes(kw.toLowerCase())) return kw;
  }
  return null;
}

export interface Classification {
  mode: Mode;
  risk: Risk;
  reason: string;
}

export function classify(task: Task): Classification {
  const text = `${task.title} ${task.sourceUrl ?? ''}`;

  const dangerous = matches(text, NEEDS_USER_KEYWORDS);
  if (dangerous) {
    return { mode: 'needs_user', risk: 'high', reason: `matched needs_user keyword: "${dangerous}"` };
  }
  const auto = matches(text, AUTONOMOUS_KEYWORDS);
  if (auto) {
    return { mode: 'autonomous', risk: 'medium', reason: `matched autonomous keyword: "${auto}"` };
  }
  const prep = matches(text, PREPARE_KEYWORDS);
  if (prep) {
    return { mode: 'prepare', risk: 'low', reason: `matched prepare keyword: "${prep}"` };
  }
  // Unknown work defaults to prepare: read/summarize only, never mutate.
  return { mode: 'prepare', risk: 'low', reason: 'no keyword matched; defaulting to prepare' };
}

function isReviewTask(task: Task): boolean {
  return /리뷰|review|レビュー/i.test(task.title);
}

// Prompt template from the design doc (§7.2). The first line of result.md is a
// machine-readable STATUS marker that the reporter parses.
export function buildPrompt(
  task: Task,
  classification: Classification,
  opts: { allowReviewComment?: boolean } = {}
): string {
  // By default, posting to GitHub is forbidden. When allow_review_comment is
  // on and this is a review task, grant an explicit, narrowly-scoped exception.
  const reviewCommentRule =
    opts.allowReviewComment && isReviewTask(task)
      ? `- EXCEPTION (explicitly enabled by the user): this is a code review, so you MAY post your review as a comment on the PR (e.g. via the gh CLI). You still must NOT approve / request-changes / create / merge the PR.`
      : `- Do not post comments on PRs or issues.`;

  return `# Task
${task.title}

# Source
- source: ${task.source}
- url: ${task.sourceUrl ?? '(none)'}
- task id: ${task.id}
- mode: ${classification.mode}

# Goal
Make as much safe progress on this task as you can.
${classification.mode === 'prepare'
    ? 'This is a PREPARE task: only research, summarize, and draft so a human can make the final call. Do not change any external or shared state.'
    : 'This is an AUTONOMOUS task: complete it directly, as far as is safe to do locally.'}

# Constraints
- Do not send messages to external services (Slack / email / calendar / etc.).
- Do not deploy, delete, change permissions, make payments, or create/merge PRs.
${reviewCommentRule}
- Do not read or move tokens, credentials, or secrets.
- If a task requires crossing any constraint above, stop there and report it under "needs user" in result.md.
- Write your result to result.md in this directory.

# Output format (result.md)
The FIRST line of result.md MUST start with one of:

STATUS: done | needs_user | blocked | failed

Then write these sections:
- one-line status summary
- what you did
- files created / modified
- remaining work
- items that need user confirmation
`;
}
