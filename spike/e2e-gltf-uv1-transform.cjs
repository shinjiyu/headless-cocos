#!/usr/bin/env node
'use strict';

/**
 * glTF texCoord=1 + KHR_texture_transform e2e.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { importGltf } = require('./importers/gltf.cjs');

const SRC = path.join(__dirname, 'fixtures', 'gltf-uv1-transform', 'uv1-transform.gltf');
const library = path.join(os.tmpdir(), 'e2e-gltf-uv1-transform');
fs.rmSync(library, { recursive: true, force: true });
fs.mkdirSync(library, { recursive: true });

const r = importGltf(SRC, library);
if (!r || !r.materials.length) throw new Error('no material');
if (!r.meshes.filter(Boolean).length) throw new Error('no mesh');

const mesh = JSON.parse(
  fs.readFileSync(path.join(library, r.uuid.slice(0, 2), `${r.meshes.find(Boolean)}.json`), 'utf8'),
);
const attrNames = mesh._struct.vertexBundles[0].attributes.map((a) => a.name);
if (!attrNames.includes('a_texCoord1')) throw new Error(`mesh missing a_texCoord1: ${attrNames}`);

const mat = JSON.parse(
  fs.readFileSync(path.join(library, r.uuid.slice(0, 2), `${r.materials[0]}.json`), 'utf8'),
);
const defs = mat._defines[0] || {};
const props = mat._props[0] || {};

if (!defs.USE_ALBEDO_MAP || !props.mainTexture) throw new Error('missing albedo');
if (defs.ALBEDO_UV !== 'v_uv1') throw new Error(`ALBEDO_UV=${defs.ALBEDO_UV}, want v_uv1`);
if (!defs.HAS_SECOND_UV) throw new Error('missing HAS_SECOND_UV');

const to = props.tilingOffset;
if (!to || to.x !== 2 || to.y !== 3 || to.z !== 0.1 || to.w !== 0.2) {
  throw new Error(`tilingOffset=${JSON.stringify(to)}, want scale(2,3) offset(0.1,0.2)`);
}

console.log('[e2e-gltf-uv1-transform] SUCCESS', {
  material: r.materials[0],
  ALBEDO_UV: defs.ALBEDO_UV,
  HAS_SECOND_UV: true,
  tilingOffset: [to.x, to.y, to.z, to.w],
});
