#!/usr/bin/env node

import {
  appendFileSync, readFileSync, writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ISSUE_TITLE = 'gpt-ai-assistant 依賴新鮮度檢查';
const EMPTY_AUDIT = {
  info: 0,
  low: 0,
  moderate: 0,
  high: 0,
  critical: 0,
  total: 0,
};

export const normalizeOutdated = (outdated = {}) => Object.entries(outdated)
  .map(([name, details]) => ({
    name,
    type: details.type ?? 'unknown',
    current: details.current ?? 'unknown',
    wanted: details.wanted ?? 'unknown',
    latest: details.latest ?? 'unknown',
  }))
  .sort((left, right) => left.name.localeCompare(right.name));

const majorOf = (version) => {
  const match = String(version).match(/^(\d+)\./);
  return match ? Number(match[1]) : null;
};

export const applyApprovedDeferrals = (rows, deferrals = {}) => rows.map((row) => {
  const deferral = deferrals[row.name];
  const currentMajor = majorOf(row.current);
  const latestMajor = majorOf(row.latest);
  const approvedMajor = Number(deferral?.latestMajor);
  const deferred = Boolean(
    deferral
      && typeof deferral.reason === 'string'
      && deferral.reason.trim()
      && row.current === row.wanted
      && Number.isInteger(currentMajor)
      && Number.isInteger(latestMajor)
      && Number.isInteger(approvedMajor)
      && currentMajor < approvedMajor
      && latestMajor === approvedMajor,
  );
  return deferred ? { ...row, deferredReason: deferral.reason } : row;
});

export const loadApprovedDeferrals = ({
  cwd = process.cwd(),
  path = '.github/dependency-deferrals.json',
} = {}) => JSON.parse(readFileSync(resolve(cwd, path), 'utf8'));

const statusFor = ({
  current, wanted, latest, deferredReason,
}) => {
  if (deferredReason) {
    return `已核准暫緩：${deferredReason}`;
  }
  if (current !== wanted) {
    return wanted === latest ? '可直接更新' : '可更新，另有新版待評估';
  }
  return current === latest ? 'OK' : '新版待評估';
};

export const normalizeAudit = (audit = {}) => {
  const counts = audit.metadata?.vulnerabilities ?? {};
  return Object.fromEntries(
    Object.keys(EMPTY_AUDIT).map((severity) => [severity, Number(counts[severity] ?? 0)]),
  );
};

export const renderMarkdown = (rows, { audit = EMPTY_AUDIT, checkError = '' } = {}) => {
  const lines = [
    `# ${ISSUE_TITLE}`,
    '',
    '| 套件 | 類型 | Lockfile 目前版 | 宣告範圍可用版 | npm 最新版 | 狀態 |',
    '| --- | --- | --- | --- | --- | --- |',
  ];

  for (const row of rows) {
    lines.push(
      `| \`${row.name}\` | \`${row.type}\` | \`${row.current}\` | \`${row.wanted}\` | \`${row.latest}\` | ${statusFor(row)} |`,
    );
  }

  if (rows.length === 0 && !checkError) {
    lines.push('| — | — | — | — | — | 全部為最新 |');
  }

  lines.push(
    '',
    '## npm audit',
    '',
    '| Info | Low | Moderate | High | Critical | 合計 |',
    '| --- | --- | --- | --- | --- | --- |',
    `| ${audit.info} | ${audit.low} | ${audit.moderate} | ${audit.high} | ${audit.critical} | ${audit.total} |`,
  );

  if (checkError) {
    lines.push('', `> 檢查失敗：${checkError}`);
  }

  lines.push(
    '',
    '本報告盤點 `package.json` 的所有直接 dependencies 與 devDependencies。',
    '宣告範圍內更新可由 Dependabot 處理；跨 major 或超出目前範圍的版本需先閱讀 migration notes 並通過完整測試。已核准暫緩只適用明列的 major，範圍內更新或下一個 major 仍會重新提醒。',
    '',
    '## 處理流程',
    '',
    '1. 檢查同一批 Dependabot PR 的風險分類、變更範圍與必要 checks。',
    '2. 低風險開發工具與 GitHub Actions minor／patch 由 guarded merge workflow 序列核准；執行期依賴與所有 major 保留人工審查。',
    '3. 每次自動或人工合併後重新執行本檢查；只有可處理的直接依賴皆為最新、已核准暫緩仍符合版本邊界、`npm audit` 為 0 且沒有 open Dependabot PR 才關閉本 issue。',
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

const runNpm = (args, { cwd }) => {
  const isWindows = process.platform === 'win32';
  const command = isWindows ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
  const commandArgs = isWindows
    ? ['/d', '/s', '/c', `npm ${args.join(' ')}`]
    : args;
  return spawnSync(command, commandArgs, { cwd, encoding: 'utf8' });
};

export const checkDependencies = ({ cwd = process.cwd() } = {}) => {
  const outdatedResult = runNpm(
    ['outdated', '--json', '--long', '--all=false'],
    { cwd },
  );
  const auditResult = runNpm(['audit', '--json'], { cwd });
  const errors = [];
  let rows = [];
  let audit = EMPTY_AUDIT;

  if (![0, 1].includes(outdatedResult.status)) {
    errors.push(
      (outdatedResult.stderr
        || outdatedResult.error?.message
        || `npm outdated exited ${outdatedResult.status}`).trim(),
    );
  } else {
    try {
      rows = normalizeOutdated(
        outdatedResult.stdout.trim() ? JSON.parse(outdatedResult.stdout) : {},
      );
    } catch (error) {
      errors.push(`無法解析 npm outdated：${error.message}`);
    }
  }

  if (![0, 1].includes(auditResult.status)) {
    errors.push(
      (auditResult.stderr
        || auditResult.error?.message
        || `npm audit exited ${auditResult.status}`).trim(),
    );
  } else {
    try {
      audit = normalizeAudit(JSON.parse(auditResult.stdout));
    } catch (error) {
      errors.push(`無法解析 npm audit：${error.message}`);
    }
  }

  return { rows, audit, checkError: errors.join('；') };
};

const parseArgs = (args) => {
  const options = {
    output: 'dependency-freshness-report.md',
    githubOutput: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--github-output') {
      options.githubOutput = true;
    } else if (args[index] === '--output' && args[index + 1]) {
      options.output = args[index + 1];
      index += 1;
    }
  }
  return options;
};

export const main = (args = process.argv.slice(2)) => {
  const options = parseArgs(args);
  const { rows: outdatedRows, audit, checkError } = checkDependencies();
  let rows = outdatedRows;
  let deferralError = '';
  try {
    rows = applyApprovedDeferrals(rows, loadApprovedDeferrals());
  } catch (error) {
    deferralError = `無法載入核准暫緩設定：${error.message}`;
  }
  const combinedError = [checkError, deferralError].filter(Boolean).join('；');
  const report = renderMarkdown(rows, { audit, checkError: combinedError });
  writeFileSync(options.output, report, 'utf8');
  process.stdout.write(report);

  if (options.githubOutput) {
    writeGithubOutput({
      needsAttention: rows.some((row) => !row.deferredReason)
        || audit.total > 0
        || Boolean(combinedError),
      checkFailed: Boolean(combinedError),
      reportPath: options.output,
    });
  }
  return 0;
};

const isEntrypoint = process.argv[1]
  ?.replaceAll('\\', '/')
  .endsWith('/tools/check-dependency-freshness.js');
if (isEntrypoint) {
  process.exitCode = main();
}
