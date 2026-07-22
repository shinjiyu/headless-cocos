#!/usr/bin/env node
'use strict';

/**
 * FBX bridge e2e: FBX2glTF → importGltf hierarchy products.
 * Requires Creator-bundled FBX2glTF (or FBX2GLTF env).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { importFbx, resolveFbx2Gltf } = require('./importers/fbx.cjs');

const FIXTURE_FBX =
  process.env.FBX_FIXTURE ||
  'D:/workspace/selfGame/temp/asset-sources/blocky-characters/Models/FBX format/character-a.fbx';

(async () => {
  const tool = resolveFbx2Gltf();
  if (!tool) throw new Error('FBX2glTF not found — set FBX2GLTF or extract Creator app.asar');
  if (!fs.existsSync(FIXTURE_FBX)) throw new Error(`fixture missing: ${FIXTURE_FBX}`);

  const dir = path.join(os.tmpdir(), `e2e-fbx-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  const fbx = path.join(dir, 'character-a.fbx');
  fs.copyFileSync(FIXTURE_FBX, fbx);
  const metaSrc = `${FIXTURE_FBX}.meta`;
  if (fs.existsSync(metaSrc)) {
    fs.copyFileSync(metaSrc, `${fbx}.meta`);
  } else {
    fs.writeFileSync(
      `${fbx}.meta`,
      JSON.stringify(
        {
          ver: '2.3.14',
          importer: 'fbx',
          imported: false,
          uuid: crypto.randomUUID(),
          files: [],
          subMetas: {},
          userData: {},
        },
        null,
        2,
      ),
    );
  }

  const library = path.join(dir, 'library');
  fs.mkdirSync(library, { recursive: true });
  const r = importFbx(fbx, library);

  if (r.source !== 'fbx') throw new Error(`expected source=fbx, got ${r.source}`);
  if (r.meshes.length !== 6) throw new Error(`expected 6 meshes, got ${r.meshes.length}`);
  if (!r.scenes || !r.scenes.length) throw new Error('missing scene prefab uuid');

  const prefabPath = path.join(library, r.uuid.slice(0, 2), `${r.scenes[0]}.json`);
  const prefab = JSON.parse(fs.readFileSync(prefabPath, 'utf8'));
  const nodes = prefab.filter((o) => o && o.__type__ === 'cc.Node');
  const mrs = prefab.filter((o) => o && o.__type__ === 'cc.MeshRenderer');
  // FBX2glTF inserts an extra RootNode vs native Kenney GLB (9 nodes).
  if (nodes.length !== 10) throw new Error(`expected 10 nodes, got ${nodes.length}`);
  if (mrs.length !== 6) throw new Error(`expected 6 MeshRenderers, got ${mrs.length}`);
  if (!nodes.some((n) => n._name === 'head')) throw new Error('missing head node');

  console.log('[e2e-fbx] SUCCESS', {
    tool: path.basename(tool),
    uuid: r.uuid,
    meshes: r.meshes.length,
    nodes: nodes.length,
    mrs: mrs.length,
  });
  fs.rmSync(dir, { recursive: true, force: true });
})().catch((err) => {
  console.error('[e2e-fbx] FAILED', err);
  process.exit(1);
});
