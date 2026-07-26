#!/usr/bin/env node

import { appendFileSync } from 'node:fs';

export const AUTO_MERGE_LABEL = 'dependencies-auto-merge';
export const MANUAL_REVIEW_LABEL = 'dependencies-manual-review';

const SEMVER_UPDATE_TYPES = new Set([
  'version-update:semver-patch',
  'version-update:semver-minor',
  'version-update:semver-major',
]);
const SAFE_ACTION_UPDATE_TYPES = new Set([
  'version-update:semver-patch',
  'version-update:semver-minor',
]);
const NPM_MANIFESTS = new Set(['package.json', 'package-lock.json']);
const CI_EXERCISED_DEV_PACKAGES = new Set([
  '@babel/core',
  '@babel/preset-env',
  '@eslint/js',
  'babel-jest',
  'eslint',
  'globals',
  'jest',
  'nodemon',
]);

const manual = (reason) => ({
  decision: 'manual',
  label: MANUAL_REVIEW_LABEL,
  reason,
});

export const classifyUpdate = ({
  ecosystem,
  dependencyType,
  updateType,
  changedFiles = [],
  dependencyNames = [],
}) => {
  const files = new Set(changedFiles.filter(Boolean).map((file) => file.replaceAll('\\', '/')));
  if (files.size === 0) {
    return manual('沒有可驗證的變更檔案，保留人工審查。');
  }
  if (!SEMVER_UPDATE_TYPES.has(updateType)) {
    return manual('無法確認版本更新幅度，保留人工審查。');
  }

  if (ecosystem === 'npm_and_yarn') {
    if (![...files].every((file) => NPM_MANIFESTS.has(file))) {
      return manual('npm 依賴 PR 超出 package manifest 與 lockfile 範圍。');
    }
    if (dependencyType === 'direct:production') {
      return manual('執行期依賴會影響 LINE、OpenAI、Google 或部署行為，保留人工審查。');
    }
    if (dependencyType !== 'direct:development') {
      return manual('不是可自動處理的直接開發依賴。');
    }

    const names = dependencyNames.filter(Boolean).map((name) => name.trim().toLowerCase());
    if (names.length === 0) {
      return manual('沒有可驗證的依賴名稱，保留人工審查。');
    }
    if (!names.every((name) => CI_EXERCISED_DEV_PACKAGES.has(name))) {
      return manual('包含未被必要 CI 直接執行的開發工具。');
    }
    return {
      decision: 'auto_merge',
      label: AUTO_MERGE_LABEL,
      reason: '開發工具由 npm ci、ESLint、module-load、完整 Jest 與 Docker smoke 直接驗證。',
    };
  }

  if (ecosystem === 'github-actions') {
    if (!SAFE_ACTION_UPDATE_TYPES.has(updateType)) {
      return manual('GitHub Actions major 更新可能改變 workflow 行為，保留人工審查。');
    }
    const workflowOnly = [...files].every(
      (file) => file.startsWith('.github/workflows/')
        && (file.endsWith('.yml') || file.endsWith('.yaml')),
    );
    if (!workflowOnly) {
      return manual('GitHub Actions PR 超出 workflow 檔案範圍。');
    }
    return {
      decision: 'auto_merge',
      label: AUTO_MERGE_LABEL,
      reason: 'GitHub Actions patch 或 minor 更新，且只修改 workflow。',
    };
  }

  return manual('未列入自動核准政策的套件生態系。');
};

export const writeGithubOutput = (result, outputPath = process.env.GITHUB_OUTPUT) => {
  if (!outputPath) return;
  appendFileSync(
    outputPath,
    `${['decision', 'label', 'reason'].map((key) => `${key}=${result[key]}`).join('\n')}\n`,
    'utf8',
  );
};

const parseArgs = (args) => {
  const options = { changedFiles: [], githubOutput: false };
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === '--github-output') {
      options.githubOutput = true;
    } else if (name === '--changed-file') {
      options.changedFiles.push(args[index + 1]);
      index += 1;
    } else if (name.startsWith('--')) {
      const key = name.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      options[key] = args[index + 1];
      index += 1;
    }
  }
  return options;
};

export const main = (args = process.argv.slice(2)) => {
  const options = parseArgs(args);
  const result = classifyUpdate({
    ecosystem: options.ecosystem,
    dependencyType: options.dependencyType,
    updateType: options.updateType,
    changedFiles: options.changedFiles,
    dependencyNames: (options.dependencyNames ?? '').split(','),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (options.githubOutput) writeGithubOutput(result);
  return 0;
};

const isEntrypoint = process.argv[1]
  ?.replaceAll('\\', '/')
  .endsWith('/tools/classify-dependabot-update.js');
if (isEntrypoint) {
  process.exitCode = main();
}
