import {
  expect, test,
} from '@jest/globals';
import { classifyUpdate } from '../tools/classify-dependabot-update.js';

test('auto-merges CI-exercised development updates', () => {
  expect(classifyUpdate({
    ecosystem: 'npm_and_yarn',
    dependencyType: 'direct:development',
    updateType: 'version-update:semver-major',
    changedFiles: ['package.json', 'package-lock.json'],
    dependencyNames: ['@babel/core', '@babel/preset-env'],
  }).decision).toBe('auto_merge');
});

test('requires manual review for production dependencies', () => {
  const result = classifyUpdate({
    ecosystem: 'npm_and_yarn',
    dependencyType: 'direct:production',
    updateType: 'version-update:semver-patch',
    changedFiles: ['package.json', 'package-lock.json'],
    dependencyNames: ['dotenv'],
  });
  expect(result.decision).toBe('manual');
  expect(result.reason).toContain('執行期');
});

test('requires manual review for files outside npm manifests', () => {
  expect(classifyUpdate({
    ecosystem: 'npm_and_yarn',
    dependencyType: 'direct:development',
    updateType: 'version-update:semver-patch',
    changedFiles: ['package.json', 'services/openai.js'],
    dependencyNames: ['eslint'],
  }).decision).toBe('manual');
});

test('auto-merges GitHub Actions minor updates limited to workflows', () => {
  expect(classifyUpdate({
    ecosystem: 'github-actions',
    dependencyType: 'direct:production',
    updateType: 'version-update:semver-minor',
    changedFiles: ['.github/workflows/ci.yml'],
    dependencyNames: ['actions/checkout'],
  }).decision).toBe('auto_merge');
});

test('requires manual review for GitHub Actions major updates', () => {
  expect(classifyUpdate({
    ecosystem: 'github-actions',
    dependencyType: 'direct:production',
    updateType: 'version-update:semver-major',
    changedFiles: ['.github/workflows/ci.yml'],
    dependencyNames: ['actions/checkout'],
  }).decision).toBe('manual');
});
