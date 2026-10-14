import { expect, test } from '@jest/globals';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const projectRequire = createRequire(`${process.cwd()}/package.json`);
const nodemonRequire = createRequire(projectRequire.resolve('nodemon/package.json'));
const chokidarRequire = createRequire(nodemonRequire.resolve('chokidar/package.json'));
const braces = chokidarRequire('braces');
const manifest = projectRequire('./tools/dependency-guards/braces-3.0.3.json');
const nested = (open, close, depth) => open.repeat(depth) + 'a,b' + close.repeat(depth);

test('actual nodemon/chokidar braces rejects deep nesting before stack exhaustion', () => {
  expect(() => braces.expand(nested('{', '}', 4000))).toThrow(new SyntaxError('Pattern nesting exceeds the safe limit of 63'));
});

test('deep nesting is controlled before actual expansion exhausts a bounded Node stack', () => {
  const script = `const { createRequire } = require('node:module');
    const n = createRequire(require.resolve('nodemon/package.json'));
    const c = createRequire(n.resolve('chokidar/package.json'));
    try { c('braces').expand('{'.repeat(4000) + 'a,b' + '}'.repeat(4000)); process.exitCode = 2; }
    catch (e) { console.log(e.name + ':' + e.message); process.exitCode = e.name === 'SyntaxError' && e.message === 'Pattern nesting exceeds the safe limit of 63' ? 0 : 42; }`;
  const result = spawnSync(process.execPath, ['--stack-size=256', '-e', script], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 10000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('SyntaxError:Pattern nesting exceeds the safe limit of 63');
});

for (const [open, close] of [['{', '}'], ['(', ')']]) {
  test(`retains 63 levels and rejects 64/65 levels for ${open}`, () => {
    expect(() => braces.parse(nested(open, close, 63))).not.toThrow();
    for (const depth of [64, 65]) {
      expect(() => braces.parse(nested(open, close, depth))).toThrow(new SyntaxError('Pattern nesting exceeds the safe limit of 63'));
    }
  });
}

test('actual consumer parser is exactly the tracked protected version', () => {
  const target = chokidarRequire.resolve('braces/lib/parse.js');
  const bytes = readFileSync(target);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.patchedSha256);
});

test('mixed and unbalanced nested input cannot bypass the combined cap', () => {
  expect(() => braces.parse('{('.repeat(31) + '{a,b}' + ')}'.repeat(31))).not.toThrow();
  for (const input of ['{('.repeat(32) + 'x' + ')}'.repeat(32), '{'.repeat(64), '('.repeat(64), '{('.repeat(4000)]) {
    expect(() => braces.parse(input)).toThrow(new SyntaxError('Pattern nesting exceeds the safe limit of 63'));
  }
});

test('ordinary glob, escaped, quoted and bracket text keep their meaning', () => {
  expect(braces.expand('src/{api,app}/*.js')).toEqual(['src/api/*.js', 'src/app/*.js']);
  expect(braces.expand('a{1..3}b')).toEqual(['a1b', 'a2b', 'a3b']);
  expect(braces.expand('a\\{b,c\\}d')).toEqual(['a{b,c}d']);
  expect(braces.expand('"' + '{'.repeat(65) + '"')).toEqual(['{'.repeat(65)]);
  expect(braces.expand('[' + '{'.repeat(65) + ']')).toEqual(['[' + '{'.repeat(65) + ']']);
  expect(() => braces.parse('abc', { maxLength: 2 })).toThrow(SyntaxError);
  expect(() => braces.expand('{1..100}', { rangeLimit: 10 })).toThrow(RangeError);
});
