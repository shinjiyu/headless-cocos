#!/usr/bin/env node
'use strict';

/**
 * FBX → glTF bridge for headless preview.
 *
 * Uses Creator-bundled FBX2glTF (`@cocos/fbx2gltf`) to convert `.fbx` into a
 * sibling `.glb`, then reuses `importGltf`. Converted glb is written next to
 * the FBX (or under os.tmpdir when the assets folder is read-only) and gets
 * its own `.meta` only if missing — the FBX uuid stays the source of truth
 * for library products by copying the FBX meta uuid onto the temp glb meta.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { importGltf } = require('./gltf.cjs');

const FBX_EXTS = new Set(['.fbx']);

function resolveFbx2Gltf() {
  const candidates = [
    process.env.FBX2GLTF,
    path.join(__dirname, '../../tmp-asar-root/node_modules/@cocos/fbx2gltf/bin', os.type(), `FBX2glTF${os.type() === 'Windows_NT' ? '.exe' : ''}`),
    path.join(__dirname, '../../../tmp-asar-root/node_modules/@cocos/fbx2gltf/bin', os.type(), `FBX2glTF${os.type() === 'Windows_NT' ? '.exe' : ''}`),
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // Try require.resolve from vendored tree
  try {
    const pkg = require.resolve('@cocos/fbx2gltf/package.json', {
      paths: [
        path.join(__dirname, '../../tmp-asar-root/node_modules'),
        process.env.NPM_ROOT || '',
      ].filter(Boolean),
    });
    const tool = path.join(path.dirname(pkg), 'bin', os.type(), `FBX2glTF${os.type() === 'Windows_NT' ? '.exe' : ''}`);
    if (fs.existsSync(tool)) return tool;
  } catch {}
  return null;
}

function writeJsonIfChanged(file, value) {
  const next = JSON.stringify(value, null, 2);
  try {
    if (fs.readFileSync(file, 'utf8') === next) return false;
  } catch {}
  fs.writeFileSync(file, next);
  return true;
}

function convertFbxToGlb(fbxPath) {
  const tool = resolveFbx2Gltf();
  if (!tool) throw new Error('FBX2glTF not found (set FBX2GLTF or extract Creator app.asar)');

  const base = path.basename(fbxPath, path.extname(fbxPath));
  const outDir = path.join(os.tmpdir(), `fbx2gltf-${crypto.createHash('md5').update(fbxPath).digest('hex').slice(0, 10)}`);
  fs.mkdirSync(outDir, { recursive: true });
  const outGlb = path.join(outDir, `${base}.glb`);

  // Skip reconvert if source mtime <= glb mtime
  if (fs.existsSync(outGlb)) {
    const a = fs.statSync(fbxPath).mtimeMs;
    const b = fs.statSync(outGlb).mtimeMs;
    if (b >= a) return outGlb;
  }

  const args = ['--binary', '--input', fbxPath, '--output', outGlb];
  const r = spawnSync(tool, args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error(`FBX2glTF failed (${r.status}): ${r.stderr || r.stdout || 'no output'}`);
  }
  // Tool may append .glb twice depending on version — normalize.
  if (!fs.existsSync(outGlb)) {
    const alt = `${outGlb}.glb`;
    if (fs.existsSync(alt)) fs.renameSync(alt, outGlb);
  }
  if (!fs.existsSync(outGlb)) throw new Error(`FBX2glTF produced no glb at ${outGlb}`);
  return outGlb;
}

function importFbx(assetPath, libraryRoot) {
  const ext = path.extname(assetPath).toLowerCase();
  if (!FBX_EXTS.has(ext)) return null;

  const metaPath = `${assetPath}.meta`;
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    meta = { uuid: crypto.randomUUID() };
    writeJsonIfChanged(metaPath, {
      ver: '2.3.14',
      importer: 'fbx',
      imported: false,
      uuid: meta.uuid,
      files: [],
      subMetas: {},
      userData: {},
    });
  }
  if (!/^[0-9a-f-]{36}$/i.test(meta.uuid || '')) {
    throw new Error(`invalid fbx uuid in ${metaPath}`);
  }

  const glbPath = convertFbxToGlb(assetPath);
  // Give the temp glb the same uuid/meta so library products stay under the FBX uuid.
  const glbMetaPath = `${glbPath}.meta`;
  writeJsonIfChanged(glbMetaPath, {
    ver: meta.ver || '2.3.14',
    importer: 'gltf',
    imported: true,
    uuid: meta.uuid,
    files: [],
    subMetas: meta.subMetas || {},
    userData: meta.userData || {},
  });

  const result = importGltf(glbPath, libraryRoot);
  if (!result) throw new Error('gltf import returned null after FBX convert');

  // Persist subMetas back onto the FBX meta (ids assigned during gltf import).
  try {
    const glbMeta = JSON.parse(fs.readFileSync(glbMetaPath, 'utf8'));
    meta.importer = 'fbx';
    meta.imported = true;
    meta.files = [];
    meta.subMetas = glbMeta.subMetas || {};
    meta.userData = { ...(glbMeta.userData || {}), convertedGlb: glbPath };
    writeJsonIfChanged(metaPath, meta);
  } catch {}

  return {
    ...result,
    assetPath,
    source: 'fbx',
    glbPath,
  };
}

module.exports = {
  FBX_EXTS,
  importFbx,
  convertFbxToGlb,
  resolveFbx2Gltf,
};
