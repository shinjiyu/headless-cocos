#!/usr/bin/env node
'use strict';

/**
 * glTF alphaMode e2e — BLEND (transparent tech) + MASK (alpha test).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { importGltf } = require('./importers/gltf.cjs');

const SRC = path.join(__dirname, 'fixtures', 'gltf-alpha', 'alpha-modes.gltf');

const library = path.join(os.tmpdir(), 'e2e-gltf-alpha');
fs.rmSync(library, { recursive: true, force: true });
fs.mkdirSync(library, { recursive: true });

const r = importGltf(SRC, library);
if (!r || r.materials.length < 2) throw new Error('expected 2 materials');

function loadMat(subUuid) {
  return JSON.parse(
    fs.readFileSync(path.join(library, r.uuid.slice(0, 2), `${subUuid}.json`), 'utf8'),
  );
}

const blend = loadMat(r.materials[0]);
const mask = loadMat(r.materials[1]);

if (blend._techIdx !== 1) throw new Error(`BLEND techIdx=${blend._techIdx}, want 1`);
if (blend._states[0].depthStencilState.depthWrite !== false) {
  throw new Error('BLEND should disable depthWrite');
}
const bt = blend._states[0].blendState.targets[0];
if (!bt.blend || bt.blendSrc !== 2 || bt.blendDst !== 4) {
  throw new Error(`BLEND blendState unexpected: ${JSON.stringify(bt)}`);
}
if (blend._states[0].rasterizerState.cullMode !== 0) {
  throw new Error('BLEND doubleSided should cullMode=0');
}
if (!blend._defines[0].USE_TWOSIDE) throw new Error('BLEND doubleSided → USE_TWOSIDE');

if (mask._techIdx !== 0) throw new Error(`MASK techIdx=${mask._techIdx}, want 0`);
if (!mask._defines[0].USE_ALPHA_TEST) throw new Error('MASK missing USE_ALPHA_TEST');
if (mask._props[0].alphaThreshold !== 0.3) {
  throw new Error(`MASK alphaThreshold=${mask._props[0].alphaThreshold}, want 0.3`);
}

console.log('[e2e-gltf-alpha] SUCCESS', {
  blend: r.materials[0],
  mask: r.materials[1],
  blendTech: blend._techIdx,
  maskCutoff: mask._props[0].alphaThreshold,
});
