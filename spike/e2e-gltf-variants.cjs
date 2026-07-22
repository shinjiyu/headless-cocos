#!/usr/bin/env node
'use strict';

/**
 * KHR_materials_variants e2e — bake selected variant into MeshRenderer slots.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { importGltf, importOptionsFromQuery } = require('./importers/gltf.cjs');

const SRC = path.join(__dirname, 'fixtures', 'gltf-variants', 'variants.gltf');

function mrMaterialUuid(prefab) {
  const mr = prefab.find((o) => o && o.__type__ === 'cc.MeshRenderer');
  if (!mr || !mr._materials || !mr._materials[0]) throw new Error('no MeshRenderer material');
  return mr._materials[0].__uuid__;
}

function albedoOf(library, uuid, matUuid) {
  const mat = JSON.parse(
    fs.readFileSync(path.join(library, uuid.slice(0, 2), `${matUuid}.json`), 'utf8'),
  );
  return mat._props[0].mainColor;
}

(async () => {
  const q = importOptionsFromQuery(new URLSearchParams('variant=Yellow'));
  if (q.variant !== 'Yellow') throw new Error(`query name ${JSON.stringify(q)}`);
  const qn = importOptionsFromQuery(new URLSearchParams('variant=1'));
  if (qn.variant !== 1) throw new Error(`query index ${JSON.stringify(qn)}`);
  if (Object.keys(importOptionsFromQuery(new URLSearchParams(''))).length) {
    throw new Error('empty query should yield {}');
  }

  const library = path.join(os.tmpdir(), 'e2e-gltf-variants');
  fs.rmSync(library, { recursive: true, force: true });
  fs.mkdirSync(library, { recursive: true });

  const def = importGltf(SRC, library);
  if (!def.variants || def.variants.names.join(',') !== 'Yellow,Cyan') {
    throw new Error(`variants=${JSON.stringify(def.variants)}`);
  }
  if (def.variants.active != null) throw new Error('default active should be null');
  if (def.materials.length !== 3) throw new Error(`materials ${def.materials.length}`);

  const meta = JSON.parse(fs.readFileSync(`${SRC}.meta`, 'utf8'));
  if (!meta.userData.materialVariants || meta.userData.materialVariants.names[0] !== 'Yellow') {
    throw new Error(`meta variants ${JSON.stringify(meta.userData.materialVariants)}`);
  }

  const prefabDef = JSON.parse(
    fs.readFileSync(path.join(library, def.uuid.slice(0, 2), `${def.scenes[0]}.json`), 'utf8'),
  );
  const defMat = mrMaterialUuid(prefabDef);
  if (defMat !== def.materials[0]) throw new Error(`default slot ${defMat} != ${def.materials[0]}`);
  const red = albedoOf(library, def.uuid, defMat);
  if (red.r !== 255 || red.g !== 0 || red.b !== 0) throw new Error(`default albedo ${JSON.stringify(red)}`);

  const libY = path.join(os.tmpdir(), 'e2e-gltf-variants-yellow');
  fs.rmSync(libY, { recursive: true, force: true });
  fs.mkdirSync(libY, { recursive: true });
  const yellow = importGltf(SRC, libY, { variant: 'Yellow' });
  if (yellow.variants.active !== 0) throw new Error(`active=${yellow.variants.active}`);
  const prefabY = JSON.parse(
    fs.readFileSync(path.join(libY, yellow.uuid.slice(0, 2), `${yellow.scenes[0]}.json`), 'utf8'),
  );
  const yMat = mrMaterialUuid(prefabY);
  if (yMat !== yellow.materials[1]) throw new Error(`yellow slot ${yMat}`);
  const yCol = albedoOf(libY, yellow.uuid, yMat);
  if (yCol.r !== 255 || yCol.g !== 255 || yCol.b !== 0) {
    throw new Error(`yellow albedo ${JSON.stringify(yCol)}`);
  }

  const libC = path.join(os.tmpdir(), 'e2e-gltf-variants-cyan');
  fs.rmSync(libC, { recursive: true, force: true });
  fs.mkdirSync(libC, { recursive: true });
  const cyan = importGltf(SRC, libC, { variant: 1 });
  if (cyan.variants.active !== 1) throw new Error(`cyan active=${cyan.variants.active}`);
  const prefabC = JSON.parse(
    fs.readFileSync(path.join(libC, cyan.uuid.slice(0, 2), `${cyan.scenes[0]}.json`), 'utf8'),
  );
  const cMat = mrMaterialUuid(prefabC);
  if (cMat !== cyan.materials[2]) throw new Error(`cyan slot ${cMat}`);

  console.log('[e2e-gltf-variants] SUCCESS', {
    names: def.variants.names,
    default: def.materials[0],
    yellow: yellow.materials[1],
    cyan: cyan.materials[2],
  });
})().catch((err) => {
  console.error('[e2e-gltf-variants] FAILED', err);
  process.exit(1);
});
