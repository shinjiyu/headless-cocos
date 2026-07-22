#!/usr/bin/env node
'use strict';

/**
 * glTF morph e2e — Khronos AnimatedMorphCube.glb
 * Asserts mesh._struct.morph + weight RealArrayTrack in CCON.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { importGltf } = require('./importers/gltf.cjs');
const { decodeCCONBinary } = require('./importers/ccon.cjs');

const FIXTURE =
  process.env.MORPH_FIXTURE ||
  path.join(__dirname, 'fixtures/gltf-morph-cube/AnimatedMorphCube.glb');

(async () => {
  if (!fs.existsSync(FIXTURE)) throw new Error(`fixture missing: ${FIXTURE}`);

  const dir = path.join(os.tmpdir(), `e2e-morph-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  const glb = path.join(dir, 'AnimatedMorphCube.glb');
  fs.copyFileSync(FIXTURE, glb);
  fs.writeFileSync(
    `${glb}.meta`,
    JSON.stringify(
      {
        ver: '2.3.14',
        importer: 'gltf',
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
  const library = path.join(dir, 'library');
  fs.mkdirSync(library);

  const r = importGltf(glb, library);
  if (!r.meshes[0]) throw new Error('no mesh');
  const mesh = JSON.parse(
    fs.readFileSync(path.join(library, r.uuid.slice(0, 2), `${r.meshes[0]}.json`), 'utf8'),
  );
  const morph = mesh._struct.morph;
  if (!morph) throw new Error('missing morph');
  if (!morph.subMeshMorphs || !morph.subMeshMorphs[0]) throw new Error('missing subMeshMorph');
  const sm = morph.subMeshMorphs[0];
  if (!sm.attributes.includes('a_position')) throw new Error(`attrs ${sm.attributes}`);
  if (sm.targets.length !== 2) throw new Error(`targets ${sm.targets.length}`);
  if (sm.targets[0].displacements.length < 1) throw new Error('no displacements');

  const bin = fs.readFileSync(path.join(library, r.uuid.slice(0, 2), `${r.meshes[0]}.bin`));
  const view = sm.targets[0].displacements[0];
  if (view.offset + view.length > bin.length) throw new Error('displacement OOB');
  if (view.count !== 72) throw new Error(`count ${view.count} (24 verts * 3)`);

  if (!r.animations.length) throw new Error('missing animation');
  const ccon = decodeCCONBinary(
    fs.readFileSync(path.join(library, r.uuid.slice(0, 2), `${r.animations[0]}.bin`)),
  );
  if (!ccon.document[0]._tracks.length) throw new Error('missing morph weight tracks');
  const track = ccon.document[ccon.document[0]._tracks[0].__id__];
  if (track.__type__ !== 'cc.animation.RealArrayTrack') {
    throw new Error(`track type ${track.__type__}`);
  }
  if (track._channels.length !== 2) throw new Error(`channels ${track._channels.length}`);
  if (ccon.document[0]._duration < 4) throw new Error(`duration ${ccon.document[0]._duration}`);

  console.log('[e2e-gltf-morph] SUCCESS', {
    uuid: r.uuid,
    targets: sm.targets.length,
    attrs: sm.attributes,
    duration: ccon.document[0]._duration,
  });
  fs.rmSync(dir, { recursive: true, force: true });
})().catch((err) => {
  console.error('[e2e-gltf-morph] FAILED', err);
  process.exit(1);
});
