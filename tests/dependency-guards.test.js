import { afterEach, expect, test } from '@jest/globals';
import { createRequire } from 'node:module';
import {
  mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const projectRequire = createRequire(`${process.cwd()}/package.json`);
const { applyDevDependencyGuards } = projectRequire('./tools/apply-dev-dependency-guards.cjs');
const manifest = projectRequire('./tools/dependency-guards/braces-3.0.3.json');
const fixtures = [];
const fixture = ({ version = '3.0.3', bytes } = {}) => {
  const root = mkdtempSync(path.join(tmpdir(), 'gpt-braces-guard-'));
  fixtures.push(root);
  writeFileSync(path.join(root, 'package.json'), '{}');
  for (const [name, v] of [['nodemon', '3.1.14'], ['chokidar', '3.5.3'], ['braces', version]]) {
    mkdirSync(path.join(root, 'node_modules', name), { recursive: true });
    writeFileSync(path.join(root, 'node_modules', name, 'package.json'), JSON.stringify({ name, version: v }));
  }
  const target = path.join(root, 'node_modules', 'braces', 'lib', 'parse.js');
  mkdirSync(path.dirname(target));
  const n = createRequire(projectRequire.resolve('nodemon/package.json'));
  const c = createRequire(n.resolve('chokidar/package.json'));
  let original = readFileSync(c.resolve('braces/lib/parse.js'), 'utf8');
  for (const replacement of manifest.replacements) original = original.replace(replacement.after, replacement.before);
  writeFileSync(target, bytes === undefined ? original : bytes);
  return { root, target };
};

afterEach(() => {
  for (const root of fixtures.splice(0)) {
    expect(path.dirname(root)).toBe(tmpdir());
    expect(path.basename(root).startsWith('gpt-braces-guard-')).toBe(true);
    rmSync(root, { recursive: true, force: true });
  }
});

test('clean original applies reproducibly, check verifies and repeated apply is idempotent', () => {
  const { root } = fixture();
  expect(() => applyDevDependencyGuards({ root, check: true })).toThrow(/not applied/);
  expect(applyDevDependencyGuards({ root })).toMatchObject({ status: 'applied', sha256: manifest.patchedSha256 });
  expect(applyDevDependencyGuards({ root, check: true })).toMatchObject({ status: 'verified', sha256: manifest.patchedSha256 });
  expect(applyDevDependencyGuards({ root })).toMatchObject({ status: 'verified' });
});

test.each([
  [{ version: '3.0.4' }, /unknown braces version/],
  [{ bytes: 'unexpected' }, /unknown braces source hash/],
])('unknown package source fails closed without writing', (options, message) => {
  const { root, target } = fixture(options);
  const before = readFileSync(target);
  expect(() => applyDevDependencyGuards({ root })).toThrow(message);
  expect(readFileSync(target)).toEqual(before);
});

test('dev omission skips only when both consumers are absent', () => {
  const { root } = fixture();
  rmSync(path.join(root, 'node_modules', 'nodemon'), { recursive: true });
  expect(() => applyDevDependencyGuards({ root, omitDev: true })).toThrow(/requires installed nodemon/);
  rmSync(path.join(root, 'node_modules', 'chokidar'), { recursive: true });
  expect(applyDevDependencyGuards({ root, omitDev: true })).toEqual({ status: 'skipped-dev-omitted' });
  expect(() => applyDevDependencyGuards({ root })).toThrow(/requires installed nodemon/);
});
