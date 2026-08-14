/**
 * Resolve the pre-baked Creator 3.8 engine snapshot.
 * Env wins; otherwise the template-library runtime, then spike/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function snapshotLooksReady(dir) {
  if (!dir) return false;
  return fs.existsSync(path.join(dir, 'preview'));
}

export function resolveEngineSnapshot(opts = {}) {
  const env = opts.env || process.env;
  const repoRoot = opts.repoRoot || path.resolve(HERE, '..');
  if (env.ENGINE_SNAPSHOT && snapshotLooksReady(env.ENGINE_SNAPSHOT)) {
    return path.resolve(env.ENGINE_SNAPSHOT);
  }
  const candidates = [
    path.join(repoRoot, 'templates/runtime/engine-snapshot'),
    path.join(repoRoot, 'spike/engine-snapshot'),
    path.join(HERE, 'engine-snapshot'),
  ];
  for (const dir of candidates) {
    if (snapshotLooksReady(dir)) return path.resolve(dir);
  }
  return '';
}
