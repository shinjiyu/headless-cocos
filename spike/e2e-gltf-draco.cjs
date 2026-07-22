#!/usr/bin/env node
'use strict';

/**
 * KHR_draco_mesh_compression e2e — decode attributes + triangle indices.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { importGltfAsync, prepareDraco } = require('./importers/gltf.cjs');

const SRC = path.join(__dirname, 'fixtures', 'gltf-draco', 'draco.gltf');

(async () => {
  await prepareDraco();
  const library = path.join(os.tmpdir(), 'e2e-gltf-draco');
  fs.rmSync(library, { recursive: true, force: true });
  fs.mkdirSync(library, { recursive: true });

  const r = await importGltfAsync(SRC, library);
  if (!r || !r.meshes.filter(Boolean).length) throw new Error('no mesh');

  const meshUuid = r.meshes.find(Boolean);
  const bin = fs.readFileSync(path.join(library, r.uuid.slice(0, 2), `${meshUuid}.bin`));
  // standard layout: POSITION(12) + NORMAL(12) + TEXCOORD_0(8) = 32
  const stride = 32;
  const x1 = bin.readFloatLE(stride);
  const y2 = bin.readFloatLE(stride * 2 + 4);
  if (Math.abs(x1 - 1) > 1e-5 || Math.abs(y2 - 1) > 1e-5) {
    throw new Error(`decoded positions wrong: v1.x=${x1} v2.y=${y2}`);
  }

  const mesh = JSON.parse(
    fs.readFileSync(path.join(library, r.uuid.slice(0, 2), `${meshUuid}.json`), 'utf8'),
  );
  if (mesh._struct.vertexBundles[0].view.count !== 3) throw new Error('bad vert count');
  if (mesh._struct.primitives[0].indexView.count !== 3) throw new Error('bad index count');

  console.log('[e2e-gltf-draco] SUCCESS', {
    mesh: meshUuid,
    verts: 3,
    indices: 3,
  });
})().catch((err) => {
  console.error('[e2e-gltf-draco] FAILED', err);
  process.exit(1);
});
