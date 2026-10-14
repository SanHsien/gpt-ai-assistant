import { expect, test } from '@jest/globals';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const projectRequire = createRequire(`${process.cwd()}/package.json`);
const parsedCap = Number(process.env.GPT_NODEMON_WATCH_TIMEOUT_MS);
const capMs = Number.isFinite(parsedCap) && parsedCap >= 2000 ? Math.min(parsedCap, 60000) : 20000;

test('protected nodemon watches normal JS, ignores node_modules and restarts once', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'gpt-nodemon-watch-'));
  const script = path.join(root, 'worker.cjs');
  mkdirSync(path.join(root, 'node_modules'));
  writeFileSync(script, 'console.log("SMOKE_READY"); setInterval(() => {}, 1000);\n');
  const child = spawn(process.execPath, [
    projectRequire.resolve('nodemon/bin/nodemon.js'), '--verbose', '--watch', root,
    '--ext', 'cjs,js', '--delay', '0.2', script,
  ], { cwd: root, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  let spawnError;
  child.on('error', (error) => { spawnError = error; });
  const append = (data) => { output = (output + data.toString()).slice(-65536); };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  const started = Date.now();
  const readyCount = () => (output.match(/SMOKE_READY/g) || []).length;
  const waitFor = async (condition) => {
    while (!condition()) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error(`nodemon exited ${child.exitCode}: ${output}`);
      if (Date.now() - started >= capMs) throw new Error(`nodemon watch cap ${capMs}ms exceeded: ${output}`);
      // Sequential polling shares one overall cap and must observe each updated process state.
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };
  try {
    await waitFor(() => readyCount() === 1 && /watching \d+ files?/.test(output));
    writeFileSync(path.join(root, 'node_modules', 'ignored.js'), '// ignored change\n');
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(readyCount()).toBe(1);
    writeFileSync(script, 'console.log("SMOKE_READY"); setInterval(() => {}, 1000); // changed\n');
    await waitFor(() => readyCount() >= 2);
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(readyCount()).toBe(2);
    expect(output).toContain('restarting due to changes');
    console.log(JSON.stringify({ nodemonWatch: 'PASS', starts: readyCount(), ignoredChanges: 1, elapsedMs: Date.now() - started, capMs }));
  } finally {
    if (child.pid && child.exitCode === null) {
      if (process.platform === 'win32') {
        const stopped = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8', timeout: 5000 });
        expect(stopped.status).toBe(0);
      } else {
        process.kill(-child.pid, 'SIGTERM');
        await Promise.race([
          new Promise((resolve) => child.once('exit', resolve)),
          new Promise((resolve) => setTimeout(resolve, 2000)),
        ]);
        if (child.exitCode === null && child.signalCode === null) process.kill(-child.pid, 'SIGKILL');
      }
    }
    expect(path.dirname(root)).toBe(tmpdir());
    expect(path.basename(root).startsWith('gpt-nodemon-watch-')).toBe(true);
    rmSync(root, { recursive: true, force: true });
  }
}, capMs + 7000);
