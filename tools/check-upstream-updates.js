#!/usr/bin/env node

// 本 repo 的公開 Git 歷史於 2026-07-18 以快照重新初始化，與上游沒有共同祖先，
// 因此不能用 `git log HEAD..upstream/main`。這支檢查器自己把上游分支 fetch 進
// 一個獨立 ref，再從 baseline 記的 reviewed_through 往後列未審 commit。
//
//     node tools/check-upstream-updates.js --output report.md --github-output

import {
  appendFileSync, readFileSync, writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

// Paths hang off the working directory rather than import.meta.url: the sibling
// dependency checker does the same, and Jest transforms these files to CommonJS,
// where import.meta does not exist. Both callers -- npm script and workflow --
// run from the repository root.
const REPO_ROOT = process.cwd();
const BASELINE_PATH = resolve(REPO_ROOT, 'tools', 'upstream-baseline.json');
const UPSTREAM_REF_PREFIX = 'refs/upstream-check';
const REQUIRED_FIELDS = ['repo', 'branch', 'reviewedThrough', 'reviewedDate'];
const FULL_SHA_LENGTH = 40;
const MAX_LISTED_FILES = 8;
const UNIT_SEPARATOR = '\u001f';

export class UpstreamCheckError extends Error {}

export const loadBaseline = (path = BASELINE_PATH) => {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    throw new UpstreamCheckError(`無法讀取 baseline：${error.message}`);
  }

  let baseline;
  try {
    baseline = JSON.parse(raw);
  } catch (error) {
    throw new UpstreamCheckError(`baseline 不是合法 JSON：${error.message}`);
  }

  const missing = REQUIRED_FIELDS.filter((field) => !baseline[field]);
  if (missing.length > 0) {
    throw new UpstreamCheckError(`baseline 缺少欄位：${missing.join('、')}`);
  }
  if (String(baseline.reviewedThrough).length !== FULL_SHA_LENGTH) {
    throw new UpstreamCheckError('reviewedThrough 必須是完整的 40 字元 SHA');
  }
  return baseline;
};

export const runGit = (args, { cwd = REPO_ROOT } = {}) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.error) {
    throw new UpstreamCheckError(`git ${args.join(' ')} 無法執行：${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new UpstreamCheckError(`git ${args.join(' ')} 失敗：${(result.stderr || '').trim()}`);
  }
  return result.stdout;
};

export const fetchUpstream = (baseline, { cwd = REPO_ROOT, git = runGit } = {}) => {
  const ref = `${UPSTREAM_REF_PREFIX}/${baseline.branch}`;
  git(['fetch', '--quiet', baseline.repo, `+refs/heads/${baseline.branch}:${ref}`], { cwd });
  return ref;
};

export const collectNewCommits = (baseline, ref, { cwd = REPO_ROOT, git = runGit } = {}) => {
  const raw = git([
    'log',
    '--reverse',
    '--date=short',
    `--format=%H${UNIT_SEPARATOR}%ad${UNIT_SEPARATOR}%s`,
    `${baseline.reviewedThrough}..${ref}`,
  ], { cwd });

  return raw
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const [sha, date, ...subjectParts] = line.split(UNIT_SEPARATOR);
      const files = git(['show', '--name-only', '--format=', sha], { cwd })
        .split('\n')
        .filter((item) => item.trim());
      return {
        sha,
        short: sha.slice(0, 7),
        date,
        subject: subjectParts.join(UNIT_SEPARATOR),
        files,
      };
    });
};

const escapeCell = (value) => String(value).replaceAll('|', '\\|');

export const upstreamSlug = (repoUrl) => {
  const match = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(String(repoUrl));
  return match ? `${match[1]}/${match[2]}` : null;
};

export const runGh = (args) => {
  const result = spawnSync('gh', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  return result.stdout;
};

// 回傳 null 而不是 []：「沒查到」和「沒有」在綠色報告裡長得一樣，只有一個是真的，
// 把兩者混成一個就是 fork 在沒有人決定的情況下停止注意上游的方式。
//
// `--state all` 是刻意的：一個項目在兩次排程之間被開了又關，對本 repo 來說仍然是
// 從沒審過；而**未合併就關閉**的 PR 永遠不會出現在 commit 軸上，那正是「上游拒收、
// 但可能對本線有價值」的一類。
export const collectNewTickets = (baseline, kind, { gh = runGh } = {}) => {
  const slug = upstreamSlug(baseline.repo);
  if (!slug) return null;
  const field = kind === 'pr' ? 'reviewedPrThrough' : 'reviewedIssueThrough';
  const reviewedThrough = Number(baseline[field] || 0);
  const raw = gh([
    kind, 'list', '--repo', slug, '--state', 'all',
    '--limit', '1000', '--json', 'number,title',
  ]);
  if (raw === null || raw === undefined) return null;
  let items;
  try {
    items = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(items)) return null;
  return items
    .filter((item) => Number(item.number) > reviewedThrough)
    .sort((left, right) => Number(left.number) - Number(right.number));
};

const renderTicketSection = (title, reviewedThrough, tickets, field) => {
  const lines = [`## ${title}`, '', `已審視至 \`#${reviewedThrough}\`（查詢用 \`--state all\`）。`, ''];
  if (tickets === null) {
    lines.push(
      '**未檢查**：`gh` 無法使用、未登入，或 baseline 沒有指向 GitHub repo。',
      '照實回報而不是寫成「沒有待審項目」——這兩件事只有一件是真的。',
      '',
    );
    return lines;
  }
  if (tickets.length === 0) {
    lines.push('該編號之後沒有新項目。', '');
    return lines;
  }
  lines.push(`該編號之後有 ${tickets.length} 筆待審視。`, '', '| 項目 | 標題 |', '| --- | --- |');
  for (const ticket of tickets) {
    lines.push(`| #${ticket.number} | ${escapeCell(ticket.title)} |`);
  }
  lines.push(
    '',
    `逐筆判斷後把理由寫進 \`docs/DECISIONS.md\`，再推進 baseline 的 \`${field}\`。`,
    '',
  );
  return lines;
};

export const renderTicketMarkdown = (baseline, prs, issues) => [
  ...renderTicketSection('上游 Pull requests', Number(baseline.reviewedPrThrough || 0), prs, 'reviewedPrThrough'),
  ...renderTicketSection('上游 Issues', Number(baseline.reviewedIssueThrough || 0), issues, 'reviewedIssueThrough'),
].join('\n');

export const renderMarkdown = (baseline, commits, { checkError = '' } = {}) => {
  const lines = [
    '# 上游更新檢查',
    '',
    `- 上游：\`${baseline.repo}\`（\`${baseline.branch}\`）`,
    `- 已審視至：\`${String(baseline.reviewedThrough).slice(0, 7)}\``,
    `- 前次審視日期：${baseline.reviewedDate}`,
    '',
  ];

  if (checkError) {
    lines.push('## 檢查失敗', '', '```text', checkError, '```', '');
    return `${lines.join('\n')}\n`;
  }

  if (commits.length === 0) {
    lines.push('## 結果', '', '上游沒有新 commit，無須審視。', '');
    return `${lines.join('\n')}\n`;
  }

  lines.push(
    '## 結果',
    '',
    `上游有 ${commits.length} 個 commit 尚未審視。`,
    '',
    '| Commit | 日期 | 主旨 | 檔案 |',
    '| --- | --- | --- | --- |',
  );
  for (const commit of commits) {
    const listed = commit.files.slice(0, MAX_LISTED_FILES).map(escapeCell).join('<br>');
    const remainder = commit.files.length - MAX_LISTED_FILES;
    const files = remainder > 0 ? `${listed}<br>… 另有 ${remainder} 個檔案` : listed;
    lines.push(
      `| \`${commit.short}\` | ${commit.date} | ${escapeCell(commit.subject)} | ${files || '（無）'} |`,
    );
  }
  lines.push(
    '',
    '逐筆判斷採用或不採用，把決策寫進 `docs/DECISIONS.md`，驗證後才推進',
    '`tools/upstream-baseline.json`——不要為了讓紅燈消失直接改 SHA。',
    '',
  );
  return `${lines.join('\n')}\n`;
};

export const writeGithubOutput = ({
  needsAttention, checkFailed, reportPath, outputPath = process.env.GITHUB_OUTPUT,
}) => {
  if (!outputPath) return;
  appendFileSync(
    outputPath,
    [
      `needs_attention=${needsAttention ? 'true' : 'false'}`,
      `check_failed=${checkFailed ? 'true' : 'false'}`,
      `report_path=${reportPath}`,
      '',
    ].join('\n'),
    'utf8',
  );
};

const parseArgs = (args) => {
  const options = {
    output: 'upstream-review-report.md',
    githubOutput: false,
    strict: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--github-output') {
      options.githubOutput = true;
    } else if (args[index] === '--strict') {
      options.strict = true;
    } else if (args[index] === '--output' && args[index + 1]) {
      options.output = args[index + 1];
      index += 1;
    }
  }
  return options;
};

export const main = (args = process.argv.slice(2)) => {
  const options = parseArgs(args);
  let baseline = {
    repo: 'unknown',
    branch: 'unknown',
    reviewedThrough: '0'.repeat(FULL_SHA_LENGTH),
    reviewedDate: 'unknown',
  };
  let commits = [];
  let checkError = '';
  let prs = null;
  let issues = null;

  try {
    baseline = loadBaseline();
    commits = collectNewCommits(baseline, fetchUpstream(baseline));
  } catch (error) {
    if (!(error instanceof UpstreamCheckError)) throw error;
    checkError = error.message;
  }

  if (!checkError) {
    // baseline 一直記著 reviewedPrThrough / reviewedIssueThrough，卻沒有任何程式
    // 讀它們——那兩個面向不是「查過沒發現」，是根本沒查，而報告綠的理由跟那兩個
    // 欄位還不存在時完全一樣。
    prs = collectNewTickets(baseline, 'pr');
    issues = collectNewTickets(baseline, 'issue');
  }

  let report = renderMarkdown(baseline, commits, { checkError });
  if (!checkError) {
    report = `${report.trimEnd()}\n\n${renderTicketMarkdown(baseline, prs, issues)}`;
  }
  writeFileSync(options.output, report, 'utf8');
  process.stdout.write(report);

  // fail closed：列舉不到 ticket 的那一次執行，不可以因為 commit 軸安靜就被讀成
  // 「上游沒事」。
  const ticketsUnavailable = !checkError && (prs === null || issues === null);
  const ticketCount = (prs || []).length + (issues || []).length;

  if (options.githubOutput) {
    writeGithubOutput({
      needsAttention:
        commits.length > 0 || ticketCount > 0 || Boolean(checkError) || ticketsUnavailable,
      checkFailed: Boolean(checkError) || ticketsUnavailable,
      reportPath: options.output,
    });
  }

  if (checkError) return 2;
  if (ticketsUnavailable) {
    process.stderr.write('ERROR: gh 無法列舉上游的 PR 或 issue。\n');
    return 2;
  }
  if (options.strict && (commits.length > 0 || ticketCount > 0)) return 1;
  return 0;
};

const isEntrypoint = process.argv[1]
  ?.replaceAll('\\', '/')
  .endsWith('/tools/check-upstream-updates.js');
if (isEntrypoint) {
  process.exitCode = main();
}
