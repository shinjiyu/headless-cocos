#!/usr/bin/env node
'use strict';

/**
 * KHR_materials_clearcoat → car-paint effect e2e.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { importGltf, CAR_PAINT_EFFECT } = require('./importers/gltf.cjs');

const SRC = path.join(__dirname, 'fixtures', 'gltf-clearcoat', 'clearcoat.gltf');
const library = path.join(os.tmpdir(), 'e2e-gltf-clearcoat');
fs.rmSync(library, { recursive: true, force: true });
fs.mkdirSync(library, { recursive: true });

const r = importGltf(SRC, library);
if (!r || !r.materials.length) throw new Error('no material');

const mat = JSON.parse(
  fs.readFileSync(path.join(library, r.uuid.slice(0, 2), `${r.materials[0]}.json`), 'utf8'),
);
const effect = mat._effectAsset && mat._effectAsset.__uuid__;
if (effect !== CAR_PAINT_EFFECT) {
  throw new Error(`effect=${effect}, want car-paint ${CAR_PAINT_EFFECT}`);
}
const props = mat._props[0] || {};
if (props.coatIntensity !== 1) throw new Error(`coatIntensity=${props.coatIntensity}`);
if (props.coatRoughness !== 0.05) throw new Error(`coatRoughness=${props.coatRoughness}`);
if (props.coatIOR !== 1.5) throw new Error(`coatIOR=${props.coatIOR}`);
if (props.metallic !== 1 || props.roughness !== 0.2) {
  throw new Error(`base PBR lost metallic=${props.metallic} roughness=${props.roughness}`);
}

console.log('[e2e-gltf-clearcoat] SUCCESS', {
  material: r.materials[0],
  effect: 'car-paint',
  coatIntensity: props.coatIntensity,
  coatRoughness: props.coatRoughness,
});
