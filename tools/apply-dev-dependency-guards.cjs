// This is an installation check, not application environment configuration.
const { createHash } = require('node:crypto');
const { readFileSync, realpathSync, writeFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const manifest = require('./dependency-guards/braces-3.0.3.json');

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const withinModules = (root, filename) => {
  const relative = path.relative(path.join(root, 'node_modules'), realpathSync(filename));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Dependency guard resolved outside project node_modules');
  }
  return filename;
};
const findPackage = (requireFrom, name, root) => {
  try {
    return withinModules(root, requireFrom.resolve(`${name}/package.json`));
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND' || error.code === 'ENOENT') return null;
    throw error;
  }
};

function applyDevDependencyGuards({ root = path.resolve(__dirname, '..'), check = false, omitDev = false } = {}) {
  const projectRequire = createRequire(path.join(root, 'package.json'));
  const nodemonPath = findPackage(projectRequire, 'nodemon', root);
  const rootChokidarPath = findPackage(projectRequire, 'chokidar', root);
  if (!nodemonPath && !rootChokidarPath && omitDev) {
    return { status: 'skipped-dev-omitted' };
  }
  if (!nodemonPath) throw new Error('Dependency guard requires installed nodemon');
  const nodemonRequire = createRequire(nodemonPath);
  const chokidarPath = findPackage(nodemonRequire, 'chokidar', root);
  if (!chokidarPath) throw new Error('Dependency guard requires nodemon chokidar');
  const chokidarRequire = createRequire(chokidarPath);
  const bracesPath = findPackage(chokidarRequire, 'braces', root);
  if (!bracesPath) throw new Error('Dependency guard requires chokidar braces');
  const version = JSON.parse(readFileSync(bracesPath, 'utf8')).version;
  if (version !== manifest.version) throw new Error('Dependency guard encountered unknown braces version');
  const target = withinModules(root, path.join(path.dirname(bracesPath), 'lib', 'parse.js'));
  const before = readFileSync(target);
  const originalHash = hash(before);
  if (originalHash === manifest.patchedSha256) {
    return { status: 'verified', version, target, sha256: originalHash };
  }
  if (originalHash !== manifest.originalSha256) throw new Error('Dependency guard encountered unknown braces source hash');
  if (check) throw new Error('Dependency guard not applied; run npm rebuild or the postinstall guard');
  let patched = before.toString('utf8');
  for (const replacement of manifest.replacements) {
    if (patched.split(replacement.before).length !== 2) throw new Error('Dependency guard patch anchor mismatch');
    patched = patched.replace(replacement.before, replacement.after);
  }
  if (hash(patched) !== manifest.patchedSha256) throw new Error('Dependency guard patched hash mismatch');
  writeFileSync(target, patched);
  if (hash(readFileSync(target)) !== manifest.patchedSha256) throw new Error('Dependency guard write verification failed');
  return { status: 'applied', version, target, sha256: manifest.patchedSha256 };
}

module.exports = { applyDevDependencyGuards };

if (require.main === module) {
  try {
    if (process.argv.slice(2).some((arg) => arg !== '--check')) throw new Error('Unknown dependency guard argument');
    const omitDev = process.env.NODE_ENV === 'production'
      || String(process.env.npm_config_omit || '').split(/[\s,]+/).includes('dev');
    console.log(JSON.stringify(applyDevDependencyGuards({ check: process.argv.includes('--check'), omitDev })));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
