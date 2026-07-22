#!/usr/bin/env node
'use strict';

/**
 * KHR_materials_transmission (+ volume/ior) → advanced/glass effect e2e.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { importGltf, GLASS_EFFECT } = require('./importers/gltf.cjs');

const SRC = path.join(__dirname, 'fixtures', 'gltf-transmission', 'transmission.gltf');
const library = path.join(os.tmpdir(), 'e2e-gltf-transmission');
fs.rmSync(library, { recursive: true, force: true });
fs.mkdirSync(library, { recursive: true });

const r = importGltf(SRC, library);
if (!r || !r.materials.length) throw new Error('no material');

const mat = JSON.parse(
  fs.readFileSync(path.join(library, r.uuid.slice(0, 2), `${r.materials[0]}.json`), 'utf8'),
);
const effect = mat._effectAsset && mat._effectAsset.__uuid__;
if (effect !== GLASS_EFFECT) {
  throw new Error(`effect=${effect}, want glass ${GLASS_EFFECT}`);
}
if (mat._techIdx !== 1) throw new Error(`techIdx=${mat._techIdx} (want two-sided=1)`);

const props = mat._props[0] || {};
if (Math.abs(props.F0 - 0.5) > 1e-4) throw new Error(`F0=${props.F0}`);
if (Math.abs(props.F90 - 0.9) > 1e-4) throw new Error(`F90=${props.F90}`);
if (Math.abs(props.roughness - 0.05) > 1e-5) throw new Error(`roughness=${props.roughness}`);
if (props.metallic != null) throw new Error('glass must drop metallic');
if (props.gradientIntensity !== 0.5) {
  throw new Error(`gradientIntensity=${props.gradientIntensity}`);
}
const gc = props.gradientColor;
if (!gc || gc.r !== 51 || gc.g !== 204 || gc.b !== 77) {
  throw new Error(`gradientColor=${JSON.stringify(gc)}`);
}
if (!(mat._defines[0] || {}).USE_GRADIENT_COLOR) {
  throw new Error('missing USE_GRADIENT_COLOR');
}
// transmission 0.9 → tint 0.235; base 0.8*0.235≈0.188 → ~48
const mc = props.mainColor;
if (!mc || mc.r < 40 || mc.r > 55) throw new Error(`mainColor tint ${JSON.stringify(mc)}`);

console.log('[e2e-gltf-transmission] SUCCESS', {
  material: r.materials[0],
  effect: 'glass',
  techIdx: mat._techIdx,
  F0: props.F0,
  F90: props.F90,
  gradientIntensity: props.gradientIntensity,
});
