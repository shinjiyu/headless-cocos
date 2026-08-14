#!/usr/bin/env node
/**
 * Assemble the version-pinned runtime kit from an existing bake.
 * Does not open Creator. Sources: docker/build-context or spike/engine-snapshot.
 *
 *   node spike/bake-runtime.mjs
 *   node spike/bake-runtime.mjs --zip
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ENGINE_VERSION, kitDir, kitStatus } = require('./runtime-kit.cjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const out = { zip: false, copy: false };
  for (const a of argv) {
    if (a === '--zip') out.zip = true;
    else if (a === '--copy') out.copy = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function linkOrCopy(src, dest, copy) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  if (copy) {
    fs.cpSync(src, dest, { recursive: true });
    return 'copy';
  }
  try {
    fs.symlinkSync(src, dest, process.platform === 'win32' ? 'junction' : 'dir');
    return 'link';
  } catch {
    fs.cpSync(src, dest, { recursive: true });
    return 'copy';
  }
}

function pickEngine() {
  const dirs = [
    path.join(REPO, 'docker/build-context/engine'),
    path.join(REPO, 'spike/engine-snapshot'),
  ];
  return dirs.find((d) => fs.existsSync(path.join(d, 'preview'))) || '';
}

function pickVendor() {
  const npm = path.join(REPO, 'docker/build-context/vendor/node_modules');
  const utils = path.join(REPO, 'docker/build-context/vendor/utils');
  if (fs.existsSync(path.join(npm, '@cocos/creator-programming-quick-pack'))) {
    return { npm, utils: fs.existsSync(utils) ? utils : '' };
  }
  const asar = path.join(REPO, 'tmp-asar-root/node_modules');
  const asarUtils = path.join(REPO, 'tmp-asar-root/utils');
  if (fs.existsSync(path.join(asar, '@cocos/creator-programming-quick-pack'))) {
    return { npm: asar, utils: fs.existsSync(asarUtils) ? asarUtils : '' };
  }
  return null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write('Bake runtime/3.8.8 from docker vendor + engine snapshot.\n');
    return;
  }

  const engine = pickEngine();
  const vendor = pickVendor();
  if (!engine || !vendor) {
    throw new Error(
      'no local bake to assemble (need docker/build-context/engine + vendor, or spike/engine-snapshot + tmp-asar-root)',
    );
  }

  const dest = kitDir(REPO);
  fs.mkdirSync(dest, { recursive: true });
  const howEngine = linkOrCopy(engine, path.join(dest, 'engine'), args.copy);
  const howNpm = linkOrCopy(vendor.npm, path.join(dest, 'node_modules'), args.copy);
  let howUtils = '';
  if (vendor.utils) howUtils = linkOrCopy(vendor.utils, path.join(dest, 'utils'), args.copy);

  const manifest = {
    version: ENGINE_VERSION,
    creator: ENGINE_VERSION,
    bakedAt: new Date().toISOString(),
    parts: ['engine', 'node_modules', 'utils'],
    note: 'Pinned headless runtime. End users unzip this kit; they do not install Creator.',
  };
  fs.writeFileSync(path.join(dest, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(
    path.join(dest, 'README.md'),
    `# Headless runtime ${ENGINE_VERSION}\n\n` +
      `Unzip here. \`preview-mirror\` and mini-packer resolve this folder automatically.\n` +
      `Do not install Cocos Creator.\n`,
  );

  const st = kitStatus({ repoRoot: REPO });
  if (!st.ready) throw new Error(`bake finished but kit not ready: ${JSON.stringify(st)}`);

  let zip = '';
  if (args.zip) {
    const dist = path.join(REPO, 'dist');
    fs.mkdirSync(dist, { recursive: true });
    zip = path.join(dist, `headless-runtime-${ENGINE_VERSION}.zip`);
    if (fs.existsSync(zip)) fs.rmSync(zip);
    if (process.platform === 'win32') {
      execFileSync(
        'powershell',
        ['-NoProfile', '-Command', `Compress-Archive -Path '${dest}\\*' -DestinationPath '${zip}'`],
        { stdio: 'inherit' },
      );
    } else {
      execFileSync('zip', ['-r', zip, '.'], { cwd: dest, stdio: 'inherit' });
    }
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      kit: dest,
      how: { engine: howEngine, node_modules: howNpm, utils: howUtils },
      zip: zip || undefined,
      ready: st.ready,
    }, null, 2)}\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    process.stderr.write(`[bake-runtime] ${e.message || e}\n`);
    process.exit(1);
  }
}
