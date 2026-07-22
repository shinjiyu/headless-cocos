#!/usr/bin/env node
'use strict';

/**
 * glTF sparse accessor e2e — dense zeros + sparse overlay on POSITION.
 * Also verifies bufferView-less sparse-only accessor via loadGltf + import.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { importGltf } = require('./importers/gltf.cjs');

const SRC = path.join(__dirname, 'fixtures', 'gltf-sparse', 'sparse.gltf');
const library = path.join(os.tmpdir(), 'e2e-gltf-sparse');
fs.rmSync(library, { recursive: true, force: true });
fs.mkdirSync(library, { recursive: true });

const r = importGltf(SRC, library);
if (!r || !r.meshes.filter(Boolean).length) throw new Error('no mesh');

const meshUuid = r.meshes.find(Boolean);
const bin = fs.readFileSync(path.join(library, r.uuid.slice(0, 2), `${meshUuid}.bin`));
const stride = 48; // pos+nor+uv+tan

const x0 = bin.readFloatLE(0);
const y0 = bin.readFloatLE(4);
const z0 = bin.readFloatLE(8);
if (x0 !== 0 || y0 !== 0 || z0 !== 0) throw new Error(`vert0=${[x0, y0, z0]}, want origin`);

const x1 = bin.readFloatLE(stride);
const y1 = bin.readFloatLE(stride + 4);
const z1 = bin.readFloatLE(stride + 8);
if (Math.abs(x1 - 1) > 1e-5 || y1 !== 0 || z1 !== 0) {
  throw new Error(`vert1=${[x1, y1, z1]}, want [1,0,0]`);
}

const x2 = bin.readFloatLE(stride * 2);
const y2 = bin.readFloatLE(stride * 2 + 4);
const z2 = bin.readFloatLE(stride * 2 + 8);
if (x2 !== 0 || Math.abs(y2 - 1) > 1e-5 || z2 !== 0) {
  throw new Error(`vert2=${[x2, y2, z2]}, want [0,1,0]`);
}

// Fully sparse POSITION (no bufferView): write temp asset
const tmpDir = path.join(os.tmpdir(), 'e2e-gltf-sparse-only');
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });
const onlyBin = Buffer.alloc(6 + 36 + 6);
let o = 0;
onlyBin.writeUInt16LE(0, o); o += 2;
onlyBin.writeUInt16LE(1, o); o += 2;
onlyBin.writeUInt16LE(2, o); o += 2;
for (const v of [0, 0, 0, 1, 0, 0, 0, 1, 0]) {
  onlyBin.writeFloatLE(v, o);
  o += 4;
}
onlyBin.writeUInt16LE(0, o); o += 2;
onlyBin.writeUInt16LE(1, o); o += 2;
onlyBin.writeUInt16LE(2, o); o += 2;
fs.writeFileSync(path.join(tmpDir, 'mesh.bin'), onlyBin);
const onlyGltf = {
  asset: { version: '2.0' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0 }],
  meshes: [{
    primitives: [{
      attributes: { POSITION: 0 },
      indices: 1,
    }],
  }],
  accessors: [
    {
      componentType: 5126,
      count: 3,
      type: 'VEC3',
      max: [1, 1, 0],
      min: [0, 0, 0],
      sparse: {
        count: 3,
        indices: { bufferView: 0, componentType: 5123 },
        values: { bufferView: 1 },
      },
    },
    { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
  ],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: 6 },
    { buffer: 0, byteOffset: 6, byteLength: 36 },
    { buffer: 0, byteOffset: 42, byteLength: 6 },
  ],
  buffers: [{ byteLength: 48, uri: 'mesh.bin' }],
};
const onlyPath = path.join(tmpDir, 'sparse-only.gltf');
fs.writeFileSync(onlyPath, JSON.stringify(onlyGltf));
const lib2 = path.join(os.tmpdir(), 'e2e-gltf-sparse-only-lib');
fs.rmSync(lib2, { recursive: true, force: true });
fs.mkdirSync(lib2, { recursive: true });
const r2 = importGltf(onlyPath, lib2);
const mesh2 = r2.meshes.find(Boolean);
const bin2 = fs.readFileSync(path.join(lib2, r2.uuid.slice(0, 2), `${mesh2}.bin`));
if (bin2.readFloatLE(0) !== 0 || bin2.readFloatLE(48) !== 1 || bin2.readFloatLE(48 * 2 + 4) !== 1) {
  throw new Error('sparse-only positions mismatch');
}

console.log('[e2e-gltf-sparse] SUCCESS', {
  overlay: [[x0, y0, z0], [x1, y1, z1], [x2, y2, z2]],
  sparseOnly: true,
});
