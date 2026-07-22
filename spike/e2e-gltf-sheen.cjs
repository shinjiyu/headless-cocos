#!/usr/bin/env node
'use strict';

/**
 * KHR_materials_sheen → fabric effect e2e.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { importGltf, FABRIC_EFFECT } = require('./importers/gltf.cjs');

const SRC = path.join(__dirname, 'fixtures', 'gltf-sheen', 'sheen.gltf');
const library = path.join(os.tmpdir(), 'e2e-gltf-sheen');
fs.rmSync(library, { recursive: true, force: true });
fs.mkdirSync(library, { recursive: true });

const r = importGltf(SRC, library);
if (!r || !r.materials.length) throw new Error('no material');

const mat = JSON.parse(
  fs.readFileSync(path.join(library, r.uuid.slice(0, 2), `${r.materials[0]}.json`), 'utf8'),
);
const effect = mat._effectAsset && mat._effectAsset.__uuid__;
if (effect !== FABRIC_EFFECT) {
  throw new Error(`effect=${effect}, want fabric ${FABRIC_EFFECT}`);
}
const props = mat._props[0] || {};
const sc = props.sheenColor;
if (!sc || sc.r !== 255 || sc.g !== 51 || sc.b !== 102) {
  throw new Error(`sheenColor=${JSON.stringify(sc)}`);
}
if (Math.abs(props.sheenRoughness - 0.35) > 1e-5) {
  throw new Error(`sheenRoughness=${props.sheenRoughness}`);
}
if (props.sheenOpacity !== 1 || props.sheenIntensity !== 1) {
  throw new Error(`sheenOpacity/Intensity ${props.sheenOpacity}/${props.sheenIntensity}`);
}
if (props.metallic !== 0 || Math.abs(props.roughness - 0.8) > 1e-5) {
  throw new Error(`base PBR lost metallic=${props.metallic} roughness=${props.roughness}`);
}
if (props.emissive || props.emissiveScale) {
  throw new Error('fabric must drop emissive props');
}

console.log('[e2e-gltf-sheen] SUCCESS', {
  material: r.materials[0],
  effect: 'fabric',
  sheenRoughness: props.sheenRoughness,
  sheenColor: [sc.r, sc.g, sc.b],
});
