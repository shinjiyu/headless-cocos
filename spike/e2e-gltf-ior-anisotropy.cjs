#!/usr/bin/env node
'use strict';

/**
 * KHR_materials_ior + specular + anisotropy e2e.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { importGltf } = require('./importers/gltf.cjs');

const SRC = path.join(__dirname, 'fixtures', 'gltf-ior-anisotropy', 'ior-anisotropy.gltf');
const library = path.join(os.tmpdir(), 'e2e-gltf-ior-anisotropy');
fs.rmSync(library, { recursive: true, force: true });
fs.mkdirSync(library, { recursive: true });

const r = importGltf(SRC, library);
if (!r || !r.materials.length) throw new Error('no material');

const mat = JSON.parse(
  fs.readFileSync(path.join(library, r.uuid.slice(0, 2), `${r.materials[0]}.json`), 'utf8'),
);
const defs = mat._defines[0] || {};
const props = mat._props[0] || {};

const ior = 1.4;
const f0 = ((ior - 1) / (ior + 1)) ** 2;
const expectSpec = (f0 / 0.08) * 0.8;
if (props.specularIntensity == null || Math.abs(props.specularIntensity - expectSpec) > 1e-5) {
  throw new Error(`specularIntensity=${props.specularIntensity}, want ${expectSpec}`);
}
if (!defs.IS_ANISOTROPY) throw new Error('missing IS_ANISOTROPY');
if (props.anisotropyIntensity !== 0.7) {
  throw new Error(`anisotropyIntensity=${props.anisotropyIntensity}`);
}
if (Math.abs(props.anisotropyRotation - 0.5) > 1e-5) {
  throw new Error(`anisotropyRotation=${props.anisotropyRotation}, want 0.5 (π/2 / π)`);
}

console.log('[e2e-gltf-ior-anisotropy] SUCCESS', {
  material: r.materials[0],
  specularIntensity: props.specularIntensity,
  anisotropyIntensity: props.anisotropyIntensity,
  anisotropyRotation: props.anisotropyRotation,
});
