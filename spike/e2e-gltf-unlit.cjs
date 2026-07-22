#!/usr/bin/env node
'use strict';

/**
 * KHR_materials_unlit → builtin-unlit e2e.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { importGltf, UNLIT_EFFECT } = require('./importers/gltf.cjs');

const SRC = path.join(__dirname, 'fixtures', 'gltf-unlit', 'unlit.gltf');
const library = path.join(os.tmpdir(), 'e2e-gltf-unlit');
fs.rmSync(library, { recursive: true, force: true });
fs.mkdirSync(library, { recursive: true });

const r = importGltf(SRC, library);
if (!r || !r.materials.length) throw new Error('no material');

const mat = JSON.parse(
  fs.readFileSync(path.join(library, r.uuid.slice(0, 2), `${r.materials[0]}.json`), 'utf8'),
);
const effect = mat._effectAsset && mat._effectAsset.__uuid__;
if (effect !== UNLIT_EFFECT) throw new Error(`effect=${effect}, want unlit ${UNLIT_EFFECT}`);

const defs = mat._defines[0] || {};
const props = mat._props[0] || {};
if (!defs.USE_TEXTURE || !props.mainTexture) throw new Error('missing USE_TEXTURE / mainTexture');
if (defs.USE_ALBEDO_MAP || defs.USE_PBR_MAP || defs.USE_NORMAL_MAP) {
  throw new Error('unlit should not set PBR map defines');
}
if (props.metallic != null || props.roughness != null) {
  throw new Error('unlit should not carry metallic/roughness props');
}
const c = props.mainColor;
if (!c || c.g < 200) throw new Error(`mainColor unexpected ${JSON.stringify(c)}`);
const to = props.tilingOffset;
if (!to || to.x !== 2 || to.y !== 2 || to.z !== 0.05 || to.w !== 0.1) {
  throw new Error(`tilingOffset=${JSON.stringify(to)}`);
}
if (mat._states[0].rasterizerState.cullMode !== 0) {
  throw new Error('doubleSided should cullMode=0');
}

console.log('[e2e-gltf-unlit] SUCCESS', {
  material: r.materials[0],
  effect: 'builtin-unlit',
  USE_TEXTURE: true,
  tilingOffset: [to.x, to.y, to.z, to.w],
});
