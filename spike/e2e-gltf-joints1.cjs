#!/usr/bin/env node
'use strict';

/**
 * JOINTS_1 / WEIGHTS_1 e2e — Creator top-4 prune into a_joints / a_weights.
 *
 * Fixture influences (per vertex):
 *   JOINTS_0=[0,1,2,3] WEIGHTS_0=[0.10,0.15,0.05,0.05]
 *   JOINTS_1=[4,5,6,7] WEIGHTS_1=[0.35,0.25,0.03,0.02]
 * Expected top-4 by weight: joints [4,5,1,0], weights [0.35,0.25,0.15,0.10]
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { importGltf } = require('./importers/gltf.cjs');

const SRC = path.join(__dirname, 'fixtures', 'gltf-joints1', 'joints1.gltf');

(async () => {
  const library = path.join(os.tmpdir(), 'e2e-gltf-joints1');
  fs.rmSync(library, { recursive: true, force: true });
  fs.mkdirSync(library, { recursive: true });

  const r = importGltf(SRC, library);
  if (!r || !r.meshes.filter(Boolean).length) throw new Error('no mesh');

  const meshUuid = r.meshes.find(Boolean);
  const mesh = JSON.parse(
    fs.readFileSync(path.join(library, r.uuid.slice(0, 2), `${meshUuid}.json`), 'utf8'),
  );
  const attrs = mesh._struct.vertexBundles[0].attributes.map((a) => a.name);
  if (!attrs.includes('a_joints') || !attrs.includes('a_weights')) {
    throw new Error(`missing skin attrs ${attrs}`);
  }
  if (attrs.includes('a_joints1') || attrs.includes('a_weights1')) {
    throw new Error('must not emit a_joints1/a_weights1 (Creator prunes to 4)');
  }
  if (mesh._struct.vertexBundles[0].view.stride !== 72) {
    throw new Error(`stride ${mesh._struct.vertexBundles[0].view.stride}`);
  }
  if (!mesh._struct.jointMaps || mesh._struct.jointMaps[0].length < 8) {
    throw new Error(`jointMaps too short ${mesh._struct.jointMaps && mesh._struct.jointMaps[0].length}`);
  }

  const bin = fs.readFileSync(path.join(library, r.uuid.slice(0, 2), `${meshUuid}.bin`));
  const stride = 72;
  const jointsOff = 48;
  const expectJ = [4, 5, 1, 0];
  const expectW = [0.35, 0.25, 0.15, 0.1];
  for (let v = 0; v < 3; v++) {
    const o = v * stride + jointsOff;
    const js = [
      bin.readUInt16LE(o),
      bin.readUInt16LE(o + 2),
      bin.readUInt16LE(o + 4),
      bin.readUInt16LE(o + 6),
    ];
    const ws = [
      bin.readFloatLE(o + 8),
      bin.readFloatLE(o + 12),
      bin.readFloatLE(o + 16),
      bin.readFloatLE(o + 20),
    ];
    if (js.join(',') !== expectJ.join(',')) {
      throw new Error(`v${v} joints ${js} != ${expectJ}`);
    }
    for (let i = 0; i < 4; i++) {
      if (Math.abs(ws[i] - expectW[i]) > 1e-5) {
        throw new Error(`v${v} weights ${ws} != ${expectW}`);
      }
    }
  }

  console.log('[e2e-gltf-joints1] SUCCESS', {
    mesh: meshUuid,
    top4: { joints: expectJ, weights: expectW },
  });
})().catch((err) => {
  console.error('[e2e-gltf-joints1] FAILED', err);
  process.exit(1);
});
