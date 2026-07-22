#!/usr/bin/env node
'use strict';

/**
 * KHR_materials_emissive_strength → emissiveScale e2e.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { importGltf, STANDARD_EFFECT } = require('./importers/gltf.cjs');

const SRC = path.join(__dirname, 'fixtures', 'gltf-emissive-strength', 'emissive-strength.gltf');
const library = path.join(os.tmpdir(), 'e2e-gltf-emissive-strength');
fs.rmSync(library, { recursive: true, force: true });
fs.mkdirSync(library, { recursive: true });

const r = importGltf(SRC, library);
if (!r || !r.materials.length) throw new Error('no material');

const mat = JSON.parse(
  fs.readFileSync(path.join(library, r.uuid.slice(0, 2), `${r.materials[0]}.json`), 'utf8'),
);
if (mat._effectAsset.__uuid__ !== STANDARD_EFFECT) {
  throw new Error(`expected standard effect, got ${mat._effectAsset.__uuid__}`);
}
const props = mat._props[0] || {};
if (!props.emissive) throw new Error('missing emissive color');
if (props.emissive.r !== 255 || props.emissive.g !== 128 || props.emissive.b !== 0) {
  throw new Error(`emissive=${JSON.stringify(props.emissive)}, want ~[255,128,0]`);
}
const s = props.emissiveScale;
if (!s || s.x !== 4.5 || s.y !== 4.5 || s.z !== 4.5) {
  throw new Error(`emissiveScale=${JSON.stringify(s)}, want [4.5,4.5,4.5]`);
}

console.log('[e2e-gltf-emissive-strength] SUCCESS', {
  material: r.materials[0],
  emissive: [props.emissive.r, props.emissive.g, props.emissive.b],
  emissiveScale: [s.x, s.y, s.z],
});
