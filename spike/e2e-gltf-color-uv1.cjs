#!/usr/bin/env node
'use strict';

/**
 * glTF COLOR_0 + TEXCOORD_1 e2e — vertex color (normalized u8) and second UV set.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { importGltf } = require('./importers/gltf.cjs');

const SRC = path.join(__dirname, 'fixtures', 'gltf-color-uv1', 'color-uv1.gltf');
const library = path.join(os.tmpdir(), 'e2e-gltf-color-uv1');
fs.rmSync(library, { recursive: true, force: true });
fs.mkdirSync(library, { recursive: true });

const r = importGltf(SRC, library);
if (!r || !r.meshes.filter(Boolean).length) throw new Error('no mesh');
if (!r.materials.length) throw new Error('no material');

const meshUuid = r.meshes.find(Boolean);
const mesh = JSON.parse(
  fs.readFileSync(path.join(library, r.uuid.slice(0, 2), `${meshUuid}.json`), 'utf8'),
);
const attrs = mesh._struct.vertexBundles[0].attributes.map((a) => a.name);
const stride = mesh._struct.vertexBundles[0].view.stride;
const names = new Set(attrs);

if (!names.has('a_color')) throw new Error(`missing a_color in ${attrs}`);
if (!names.has('a_texCoord1')) throw new Error(`missing a_texCoord1 in ${attrs}`);
// 48 base + 16 color + 8 uv1 = 72
if (stride !== 72) throw new Error(`stride=${stride}, want 72`);

const mat = JSON.parse(
  fs.readFileSync(path.join(library, r.uuid.slice(0, 2), `${r.materials[0]}.json`), 'utf8'),
);
if (!mat._defines[0].USE_VERTEX_COLOR) {
  throw new Error('material missing USE_VERTEX_COLOR');
}

// Spot-check first vertex color (red → 1,0,0,1) at color offset 48
const bin = fs.readFileSync(path.join(library, r.uuid.slice(0, 2), `${meshUuid}.bin`));
const r0 = bin.readFloatLE(48);
const g0 = bin.readFloatLE(52);
const b0 = bin.readFloatLE(56);
const a0 = bin.readFloatLE(60);
if (Math.abs(r0 - 1) > 1e-5 || Math.abs(g0) > 1e-5 || Math.abs(b0) > 1e-5 || Math.abs(a0 - 1) > 1e-5) {
  throw new Error(`vert0 color=${[r0, g0, b0, a0]}, want [1,0,0,1]`);
}
const u1 = bin.readFloatLE(64);
const v1 = bin.readFloatLE(68);
if (Math.abs(u1 - 0.5) > 1e-5 || Math.abs(v1 - 0.5) > 1e-5) {
  throw new Error(`vert0 uv1=${[u1, v1]}, want [0.5,0.5]`);
}

console.log('[e2e-gltf-color-uv1] SUCCESS', {
  mesh: meshUuid,
  attrs,
  stride,
  useVertexColor: true,
});
