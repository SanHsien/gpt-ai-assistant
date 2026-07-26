import {
  afterEach, expect, test,
} from '@jest/globals';
import {
  normalizeOutdated,
  normalizeAudit,
  renderMarkdown,
  writeGithubOutput,
} from '../tools/check-dependency-freshness.js';
import {
  mkdtempSync, readFileSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let temporaryDirectory;

afterEach(() => {
  if (temporaryDirectory) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  }
});

test('normalizes and sorts npm outdated results', () => {
  const rows = normalizeOutdated({
    zeta: {
      current: '1.0.0', wanted: '1.1.0', latest: '2.0.0', type: 'dependencies',
    },
    alpha: {
      current: '3.0.0', wanted: '3.0.0', latest: '3.1.0', type: 'devDependencies',
    },
  });

  expect(rows).toEqual([
    {
      name: 'alpha',
      current: '3.0.0',
      wanted: '3.0.0',
      latest: '3.1.0',
      type: 'devDependencies',
    },
    {
      name: 'zeta',
      current: '1.0.0',
      wanted: '1.1.0',
      latest: '2.0.0',
      type: 'dependencies',
    },
  ]);
});

test('renders actionable and current reports', () => {
  const report = renderMarkdown([{
    name: 'example',
    current: '1.0.0',
    wanted: '1.1.0',
    latest: '2.0.0',
    type: 'dependencies',
  }], {
    audit: {
      info: 0, low: 0, moderate: 0, high: 2, critical: 0, total: 2,
    },
  });
  expect(report).toContain('可更新，另有新版待評估');
  expect(report).toContain('| 0 | 0 | 0 | 2 | 0 | 2 |');
  expect(renderMarkdown([])).toContain('全部為最新');
  expect(renderMarkdown([], { checkError: 'registry timeout' }))
    .toContain('檢查失敗：registry timeout');
});

test('normalizes missing npm audit severities', () => {
  expect(normalizeAudit({
    metadata: {
      vulnerabilities: { high: 3, total: 3 },
    },
  })).toEqual({
    info: 0,
    low: 0,
    moderate: 0,
    high: 3,
    critical: 0,
    total: 3,
  });
});

test('writes GitHub Actions outputs', () => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'dependency-freshness-'));
  const outputPath = join(temporaryDirectory, 'github-output.txt');

  writeGithubOutput({
    needsAttention: true,
    checkFailed: false,
    reportPath: 'dependency-freshness-report.md',
    outputPath,
  });

  expect(readFileSync(outputPath, 'utf8')).toBe(
    'needs_attention=true\n'
      + 'check_failed=false\n'
      + 'report_path=dependency-freshness-report.md\n',
  );
});
