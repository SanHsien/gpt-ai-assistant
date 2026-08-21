import {
  afterEach, expect, test,
} from '@jest/globals';
import {
  UpstreamCheckError,
  collectNewCommits,
  fetchUpstream,
  loadBaseline,
  renderMarkdown,
  writeGithubOutput,
} from '../tools/check-upstream-updates.js';
import {
  mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const UNIT_SEPARATOR = '\u001f';

let temporaryDirectory;

const makeTemporaryDirectory = () => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'upstream-check-'));
  return temporaryDirectory;
};

const sampleBaseline = () => ({
  repo: 'https://example.invalid/upstream.git',
  branch: 'main',
  reviewedThrough: 'a'.repeat(40),
  reviewedDate: '2026-07-17',
});

afterEach(() => {
  if (temporaryDirectory) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  }
});

test('the committed baseline points at the upstream this repo was derived from', () => {
  const baseline = loadBaseline();

  expect(baseline.repo).toContain('memochou1993/gpt-ai-assistant');
  expect(baseline.branch).toBe('main');
  expect(baseline.reviewedThrough).toHaveLength(40);
});

test('rejects a baseline that is missing, malformed, or incomplete', () => {
  const directory = makeTemporaryDirectory();

  expect(() => loadBaseline(join(directory, 'missing.json'))).toThrow(UpstreamCheckError);

  const malformed = join(directory, 'malformed.json');
  writeFileSync(malformed, '{', 'utf8');
  expect(() => loadBaseline(malformed)).toThrow(/合法 JSON/);

  const incomplete = join(directory, 'incomplete.json');
  writeFileSync(incomplete, JSON.stringify({ repo: 'x' }), 'utf8');
  expect(() => loadBaseline(incomplete)).toThrow(/缺少欄位/);
});

test('rejects an abbreviated SHA, which would silently match the wrong commit', () => {
  const directory = makeTemporaryDirectory();
  const path = join(directory, 'baseline.json');
  writeFileSync(path, JSON.stringify({ ...sampleBaseline(), reviewedThrough: 'd84c806' }), 'utf8');

  expect(() => loadBaseline(path)).toThrow(/40 字元 SHA/);
});

test('fetches the upstream branch into its own ref', () => {
  const calls = [];
  const git = (args) => {
    calls.push(args);
    return '';
  };

  const ref = fetchUpstream(sampleBaseline(), { git });

  expect(ref).toBe('refs/upstream-check/main');
  expect(calls[0]).toEqual([
    'fetch',
    '--quiet',
    'https://example.invalid/upstream.git',
    '+refs/heads/main:refs/upstream-check/main',
  ]);
});

test('lists commits after the reviewed SHA with the files each one touched', () => {
  const sha = 'b'.repeat(40);
  const git = (args) => {
    if (args[0] === 'log') {
      return `${sha}${UNIT_SEPARATOR}2026-07-20${UNIT_SEPARATOR}fix: 修 webhook | queue\n`;
    }
    return 'api/index.js\nservices/reminders.js\n';
  };

  const commits = collectNewCommits(sampleBaseline(), 'refs/upstream-check/main', { git });

  expect(commits).toHaveLength(1);
  expect(commits[0].short).toBe('bbbbbbb');
  expect(commits[0].date).toBe('2026-07-20');
  expect(commits[0].subject).toBe('fix: 修 webhook | queue');
  expect(commits[0].files).toEqual(['api/index.js', 'services/reminders.js']);
});

test('reports a clean upstream and a failed check differently', () => {
  const clean = renderMarkdown(sampleBaseline(), []);
  const failed = renderMarkdown(sampleBaseline(), [], { checkError: 'fetch 失敗' });

  expect(clean).toContain('上游沒有新 commit');
  expect(failed).toContain('檢查失敗');
  expect(failed).toContain('fetch 失敗');
  expect(failed).not.toContain('上游沒有新 commit');
});

test('escapes pipes in subjects and caps the file list', () => {
  const report = renderMarkdown(sampleBaseline(), [{
    sha: 'c'.repeat(40),
    short: 'ccccccc',
    date: '2026-07-21',
    subject: 'feat: a | b',
    files: Array.from({ length: 10 }, (unused, index) => `file-${index}.js`),
  }]);

  expect(report).toContain('上游有 1 個 commit 尚未審視');
  expect(report).toContain('feat: a \\| b');
  expect(report).toContain('另有 2 個檔案');
});

test('writes the status fields the workflow branches on', () => {
  const directory = makeTemporaryDirectory();
  const outputPath = join(directory, 'github-output');
  writeFileSync(outputPath, '', 'utf8');

  writeGithubOutput({
    needsAttention: true,
    checkFailed: false,
    reportPath: 'upstream-review-report.md',
    outputPath,
  });

  expect(readFileSync(outputPath, 'utf8')).toBe([
    'needs_attention=true',
    'check_failed=false',
    'report_path=upstream-review-report.md',
    '',
  ].join('\n'));
});

test('writing the status fields is a no-op outside Actions', () => {
  expect(() => writeGithubOutput({
    needsAttention: true,
    checkFailed: true,
    reportPath: 'report.md',
    outputPath: undefined,
  })).not.toThrow();
});
