#!/usr/bin/env node
'use strict';

/**
 * Smoke-run local glTF importer e2es (no browser / no network by default).
 *
 *   node spike/e2e-gltf-all.cjs
 *   node spike/e2e-gltf-all.cjs --extra   # also try morph/anim/skin/fbx/polyhaven when fixtures exist
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const EXTRA = process.argv.includes('--extra');

/** Disk-only fixture tests that ship with the repo. */
const CORE = [
  'e2e-gltf-alpha.cjs',
  'e2e-gltf-clearcoat.cjs',
  'e2e-gltf-color-uv1.cjs',
  'e2e-gltf-draco.cjs',
  'e2e-gltf-emissive-strength.cjs',
  'e2e-gltf-ior-anisotropy.cjs',
  'e2e-gltf-joints1.cjs',
  'e2e-gltf-meshopt.cjs',
  'e2e-gltf-multibuffer.cjs',
  'e2e-gltf-sheen.cjs',
  'e2e-gltf-sparse.cjs',
  'e2e-gltf-transmission.cjs',
  'e2e-gltf-unlit.cjs',
  'e2e-gltf-uv1-transform.cjs',
  'e2e-gltf-variants.cjs',
];

function run(script, args = []) {
  const abs = path.join(ROOT, script);
  const label = [script, ...args].join(' ');
  process.stdout.write(`→ ${label} ... `);
  const r = spawnSync(process.execPath, [abs, ...args], {
    cwd: path.join(ROOT, '..'),
    encoding: 'utf8',
    env: process.env,
  });
  if (r.status === 0) {
    console.log('ok');
    return true;
  }
  console.log('FAIL');
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  return false;
}

function existsEnvOrPath(envKey, fallback) {
  const p = process.env[envKey] || fallback;
  return p && fs.existsSync(p) ? p : null;
}

const failed = [];
for (const s of CORE) {
  if (!run(s)) failed.push(s);
}

if (EXTRA) {
  const morph = existsEnvOrPath(
    'MORPH_FIXTURE',
    path.join(ROOT, 'fixtures/gltf-morph-cube/AnimatedMorphCube.glb'),
  );
  if (morph) {
    if (!run('e2e-gltf-morph.cjs')) failed.push('e2e-gltf-morph.cjs');
  } else {
    console.log('↷ skip e2e-gltf-morph.cjs (fixture missing)');
  }

  const anim = existsEnvOrPath(
    'GLTF_ANIM_FIXTURE',
    'D:/workspace/selfGame/assets/AssetPool/kenney/kenney-local/asset_584a5cb0050a70f7',
  );
  if (anim) {
    if (!run('e2e-gltf-anim.cjs', ['--disk-only'])) failed.push('e2e-gltf-anim.cjs');
  } else {
    console.log('↷ skip e2e-gltf-anim.cjs (fixture missing)');
  }

  const soldier =
    existsEnvOrPath(
      'SOLDIER_GLTF_DIR',
      'D:/workspace/perlab/temp/asset-db/assets/fbx2gltf-e3553cad-2f15-4293-859a-8f43c780f289/out',
    ) || existsEnvOrPath('SOLDIER_FBX', null);
  if (soldier) {
    if (!run('e2e-gltf-skin.cjs')) failed.push('e2e-gltf-skin.cjs');
  } else {
    console.log('↷ skip e2e-gltf-skin.cjs (soldier fixture missing)');
  }

  if (process.env.SKIP_NETWORK === '1') {
    console.log('↷ skip network e2es (SKIP_NETWORK=1)');
  } else {
    if (!run('e2e-gltf-pbr.cjs')) failed.push('e2e-gltf-pbr.cjs');
    if (!run('e2e-polyhaven.cjs')) failed.push('e2e-polyhaven.cjs');
  }

  if (!run('e2e-fbx.cjs')) failed.push('e2e-fbx.cjs');
}

console.log('');
if (failed.length) {
  console.error(`[e2e-gltf-all] FAILED (${failed.length}): ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`[e2e-gltf-all] SUCCESS (${CORE.length} core${EXTRA ? ' + extra' : ''})`);
