#!/usr/bin/env node
'use strict';

/**
 * glTF PBR material e2e — Poly Haven wooden_table_02 (diff + normal + ARM/ORM).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { fetchModelCached } = require('./importers/polyhaven.cjs');
const { importGltf } = require('./importers/gltf.cjs');

const ASSET_ID = process.env.POLYHAVEN_ID || 'wooden_table_02';

(async () => {
  const pkg = await fetchModelCached(ASSET_ID, { resolution: '1k' });
  const library = path.join(os.tmpdir(), `e2e-pbr-${ASSET_ID}`);
  fs.rmSync(library, { recursive: true, force: true });
  fs.mkdirSync(library, { recursive: true });

  const r = importGltf(pkg.entryGltf, library);
  if (!r.materials.length) throw new Error('no materials');

  const mat = JSON.parse(
    fs.readFileSync(path.join(library, r.uuid.slice(0, 2), `${r.materials[0]}.json`), 'utf8'),
  );
  const defs = mat._defines[0] || {};
  const props = mat._props[0] || {};

  if (!defs.USE_ALBEDO_MAP || !props.mainTexture) throw new Error('missing albedo map');
  if (!defs.USE_NORMAL_MAP || !props.normalMap) throw new Error('missing normal map');
  if (!defs.USE_PBR_MAP || !props.pbrMap) throw new Error('missing pbrMap (ORM/metal-rough)');
  if (props.metallic == null || props.roughness == null) throw new Error('missing metallic/roughness factors');

  // Three distinct texture uuids
  const uuids = [props.mainTexture.__uuid__, props.normalMap.__uuid__, props.pbrMap.__uuid__];
  if (new Set(uuids).size !== 3) throw new Error(`texture uuids not distinct: ${uuids}`);

  console.log('[e2e-gltf-pbr] SUCCESS', {
    assetId: ASSET_ID,
    material: r.materials[0],
    defines: defs,
    maps: {
      albedo: props.mainTexture.__uuid__.slice(-12),
      normal: props.normalMap.__uuid__.slice(-12),
      pbr: props.pbrMap.__uuid__.slice(-12),
    },
  });
})().catch((err) => {
  console.error('[e2e-gltf-pbr] FAILED', err);
  process.exit(1);
});
