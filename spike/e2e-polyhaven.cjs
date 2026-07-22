#!/usr/bin/env node
'use strict';

/**
 * Poly Haven → headless glTF import e2e.
 *
 * Default asset: wooden_table_02 (1k, ~200 tris) — small CC0 model.
 * Override: POLYHAVEN_ID=... node spike/e2e-polyhaven.cjs
 *
 * Offline: skip network if POLYHAVEN_OFFLINE=1 and cache already populated.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { fetchModelCached, listModels } = require('./importers/polyhaven.cjs');
const { importGltf } = require('./importers/gltf.cjs');

const ASSET_ID = process.env.POLYHAVEN_ID || 'wooden_table_02';
const RESOLUTION = process.env.POLYHAVEN_RES || '1k';
const LIST_ONLY = process.argv.includes('--list');

(async () => {
  if (LIST_ONLY) {
    const rows = await listModels({ maxPoly: 1000, limit: 20 });
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  console.log('[e2e-polyhaven] fetching', ASSET_ID, `@${RESOLUTION}`);
  const fetched = await fetchModelCached(ASSET_ID, { resolution: RESOLUTION });
  console.log('[e2e-polyhaven] package', {
    name: fetched.info.name,
    polycount: fetched.info.polycount,
    files: fetched.files.length,
    entry: path.basename(fetched.entryGltf),
  });

  const library = path.join(os.tmpdir(), `polyhaven-lib-${ASSET_ID}`);
  fs.rmSync(library, { recursive: true, force: true });
  fs.mkdirSync(library, { recursive: true });

  const r = importGltf(fetched.entryGltf, library);
  if (!r || !r.meshes.filter(Boolean).length) {
    throw new Error('import produced no meshes');
  }
  if (!r.scenes.length) throw new Error('import produced no scene prefab');

  const meshJson = JSON.parse(
    fs.readFileSync(path.join(library, r.uuid.slice(0, 2), `${r.meshes.find(Boolean)}.json`), 'utf8'),
  );
  if (meshJson.__type__ !== 'cc.Mesh') throw new Error('bad mesh type');
  if (!meshJson._struct || !meshJson._struct.primitives.length) {
    throw new Error('mesh missing primitives');
  }

  console.log('[e2e-polyhaven] SUCCESS', {
    assetId: ASSET_ID,
    uuid: r.uuid,
    meshes: r.meshes.filter(Boolean).length,
    materials: r.materials.length,
    textures: r.textures.length,
    scenes: r.scenes.length,
    source: `https://polyhaven.com/a/${ASSET_ID}`,
  });
})().catch((err) => {
  console.error('[e2e-polyhaven] FAILED', err);
  process.exit(1);
});
