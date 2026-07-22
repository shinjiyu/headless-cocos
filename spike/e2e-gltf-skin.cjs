#!/usr/bin/env node
'use strict';

/**
 * glTF skin e2e — Creator soldier (via intermediate glTF or FBX).
 * Asserts: 4 skeletons, skinned meshes (stride 72), SkinnedMeshRenderer,
 * SkeletalAnimation, bindposes match inverseBindMatrices.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { importGltf } = require('./importers/gltf.cjs');
const { importFbx } = require('./importers/fbx.cjs');

const GLTF_OUT =
  process.env.SOLDIER_GLTF_DIR ||
  'D:/workspace/perlab/temp/asset-db/assets/fbx2gltf-e3553cad-2f15-4293-859a-8f43c780f289/out';
const FBX_SRC =
  process.env.SOLDIER_FBX ||
  'C:/ProgramData/cocos/editors/Creator/3.8.8/resources/templates/hello-3d-world/assets/model/helloWorld/soldier.FBX';
const META_SRC =
  process.env.SOLDIER_META ||
  'D:/workspace/perlab/assets/model/helloWorld/soldier.FBX.meta';
const USE_FBX = process.argv.includes('--fbx');

(async () => {
  const dir = path.join(os.tmpdir(), `e2e-skin-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  const library = path.join(dir, 'library');
  fs.mkdirSync(library);

  let result;
  if (USE_FBX) {
    if (!fs.existsSync(FBX_SRC)) throw new Error(`FBX missing: ${FBX_SRC}`);
    const fbx = path.join(dir, 'soldier.FBX');
    fs.copyFileSync(FBX_SRC, fbx);
    if (fs.existsSync(META_SRC)) fs.copyFileSync(META_SRC, `${fbx}.meta`);
    result = importFbx(fbx, library);
  } else {
    const gltfPath = path.join(GLTF_OUT, 'out.gltf');
    if (!fs.existsSync(gltfPath)) throw new Error(`glTF missing: ${gltfPath}`);
    fs.copyFileSync(gltfPath, path.join(dir, 'soldier.gltf'));
    fs.copyFileSync(path.join(GLTF_OUT, 'buffer.bin'), path.join(dir, 'buffer.bin'));
    const jpg = path.join(GLTF_OUT, 'shield.jpg');
    if (fs.existsSync(jpg)) fs.copyFileSync(jpg, path.join(dir, 'shield.jpg'));
    if (fs.existsSync(META_SRC)) {
      const meta = JSON.parse(fs.readFileSync(META_SRC, 'utf8'));
      meta.importer = 'gltf';
      fs.writeFileSync(path.join(dir, 'soldier.gltf.meta'), JSON.stringify(meta, null, 2));
    }
    result = importGltf(path.join(dir, 'soldier.gltf'), library);
  }

  if (!result.skeletons || result.skeletons.length !== 4) {
    throw new Error(`expected 4 skeletons, got ${result.skeletons && result.skeletons.length}`);
  }
  if (result.meshes.filter(Boolean).length !== 4) {
    throw new Error(`expected 4 meshes, got ${result.meshes.filter(Boolean).length}`);
  }

  const sk0 = JSON.parse(
    fs.readFileSync(path.join(library, result.uuid.slice(0, 2), `${result.skeletons[0]}.json`), 'utf8'),
  );
  if (sk0.__type__ !== 'cc.Skeleton') throw new Error('bad skeleton type');
  if (sk0._joints.length !== 22) throw new Error(`joints ${sk0._joints.length}`);
  if (!sk0._joints[0].startsWith('RootNode/')) throw new Error(`bad joint path ${sk0._joints[0]}`);
  if (sk0._bindposes.length !== 22) throw new Error(`bindposes ${sk0._bindposes.length}`);
  if (Math.abs(sk0._bindposes[0].m00 - 13.330132484436035) > 1e-5) {
    throw new Error(`bindpose m00 ${sk0._bindposes[0].m00}`);
  }

  // Prefer body mesh with 22 jointMaps if sub-id preserved
  const bodyUuid = result.meshes.find((u) => u && u.endsWith('@18751')) || result.meshes[0];
  const mesh = JSON.parse(
    fs.readFileSync(path.join(library, result.uuid.slice(0, 2), `${bodyUuid}.json`), 'utf8'),
  );
  const attrs = mesh._struct.vertexBundles[0].attributes.map((a) => a.name);
  if (!attrs.includes('a_joints') || !attrs.includes('a_weights')) {
    throw new Error(`missing skin attrs ${attrs}`);
  }
  if (mesh._struct.vertexBundles[0].view.stride !== 72) {
    throw new Error(`stride ${mesh._struct.vertexBundles[0].view.stride}`);
  }
  if (!mesh._struct.jointMaps || !mesh._struct.jointMaps[0].length) {
    throw new Error('missing jointMaps');
  }

  const prefab = JSON.parse(
    fs.readFileSync(path.join(library, result.uuid.slice(0, 2), `${result.scenes[0]}.json`), 'utf8'),
  );
  const smr = prefab.filter((o) => o && o.__type__ === 'cc.SkinnedMeshRenderer');
  const sa = prefab.find((o) => o && o.__type__ === 'cc.SkeletalAnimation');
  const mr = prefab.filter((o) => o && o.__type__ === 'cc.MeshRenderer');
  if (smr.length !== 4) throw new Error(`SMR count ${smr.length}`);
  if (!sa) throw new Error('missing SkeletalAnimation');
  if (mr.length !== 0) throw new Error(`unexpected MeshRenderer ${mr.length}`);
  if (!smr[0]._skeleton || !smr[0]._skinningRoot) throw new Error('SMR missing skeleton/root');

  console.log('[e2e-gltf-skin] SUCCESS', {
    via: USE_FBX ? 'fbx' : 'gltf',
    uuid: result.uuid,
    skeletons: result.skeletons.length,
    smr: smr.length,
    joints: sk0._joints.length,
  });
  fs.rmSync(dir, { recursive: true, force: true });
})().catch((err) => {
  console.error('[e2e-gltf-skin] FAILED', err);
  process.exit(1);
});
