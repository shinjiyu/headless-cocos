#!/usr/bin/env node
'use strict';

/**
 * Minimal Cocos Creator 3.8 Spine importer for headless preview.
 *
 * Input: assets/**.json or **.skel (Spine 3.8 export) + sibling .atlas +
 * page PNGs.
 * Output: library/<xx>/<uuid>.json  sp.SkeletonData
 *
 * Engine contract (cocos/spine/skeleton-data.ts):
 *   serialized fields — _skeletonJson (object), _atlasText (string),
 *   textures (Texture2D refs), textureNames (page file names), scale.
 *   Runtime feeds these to spine.wasmUtil.createSpineSkeletonDataWithJson.
 *
 * Detection: a .json file whose body has `skeleton.spine` (version string),
 * or any `.skel` file. Creator copies `.skel` bytes to `<uuid>.bin` and sets
 * `_native: ".bin"` in the SkeletonData import JSON.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { importImage } = require('./image.cjs');

function isSpineJson(parsed) {
  return !!(parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    && parsed.skeleton && typeof parsed.skeleton === 'object' && parsed.skeleton.spine);
}

function atlasPageNames(atlasText) {
  // Page name = first non-empty line of each page block (blank-line separated),
  // always an image filename.
  const names = [];
  for (const raw of atlasText.split(/\r?\n/)) {
    const line = raw.trim();
    if (/\.(png|jpe?g|webp)$/i.test(line) && !line.includes(':')) names.push(line);
  }
  return names;
}

function writeJsonIfChanged(file, value) {
  const next = JSON.stringify(value, null, 2);
  try {
    if (fs.readFileSync(file, 'utf8') === next) return false;
  } catch {}
  fs.writeFileSync(file, next);
  return true;
}

function writeBytesIfChanged(file, bytes) {
  try {
    if (Buffer.compare(fs.readFileSync(file), bytes) === 0) return false;
  } catch {}
  fs.writeFileSync(file, bytes);
  return true;
}

function prepareSpine(assetPath, libraryRoot) {
  const base = assetPath.slice(0, -path.extname(assetPath).length);
  const atlasPath = `${base}.atlas`;
  if (!fs.existsSync(atlasPath)) {
    throw new Error(`spine atlas missing: ${path.basename(atlasPath)}`);
  }
  const atlasText = fs.readFileSync(atlasPath, 'utf8');
  const pageNames = atlasPageNames(atlasText);
  if (!pageNames.length) throw new Error('spine atlas has no pages');

  const textures = [];
  for (const pageName of pageNames) {
    const pagePath = path.join(path.dirname(assetPath), pageName);
    if (!fs.existsSync(pagePath)) throw new Error(`spine page image missing: ${pageName}`);
    const page = importImage(pagePath, libraryRoot);
    if (!page) throw new Error(`unsupported spine page image: ${pageName}`);
    textures.push({
      __uuid__: page.textureUuid,
      __expectedType__: 'cc.Texture2D',
    });
  }

  const metaPath = `${assetPath}.meta`;
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    meta = { uuid: crypto.randomUUID() };
  }
  if (!/^[0-9a-f-]{36}$/i.test(meta.uuid || '')) {
    throw new Error(`invalid spine uuid in ${metaPath}`);
  }
  meta.ver ||= '1.2.7';
  meta.importer = 'spine-data';
  meta.imported = true;
  meta.subMetas ||= {};
  meta.userData ||= {};

  return {
    base,
    atlasText,
    pageNames,
    textures,
    meta,
    metaPath,
  };
}

/**
 * @param assetPath absolute path of the spine .json
 * @param parsed    pre-parsed JSON body (caller already read it for detection)
 */
function importSpine(assetPath, libraryRoot, parsed) {
  if (!parsed) {
    try { parsed = JSON.parse(fs.readFileSync(assetPath, 'utf8')); } catch { return null; }
  }
  if (!isSpineJson(parsed)) return null;

  const prepared = prepareSpine(assetPath, libraryRoot);
  const {
    base, atlasText, pageNames, textures, meta, metaPath,
  } = prepared;
  const name = path.basename(base);
  meta.files = ['.json'];

  const uuid = meta.uuid;
  const dir = path.join(libraryRoot, uuid.slice(0, 2));
  fs.mkdirSync(dir, { recursive: true });

  const changed = [];
  if (writeJsonIfChanged(metaPath, meta)) changed.push(metaPath);
  if (writeJsonIfChanged(path.join(dir, `${uuid}.json`), {
    __type__: 'sp.SkeletonData',
    _name: name,
    _objFlags: 0,
    __editorExtras__: {},
    _native: '',
    _skeletonJson: parsed,
    _atlasText: atlasText,
    textures,
    textureNames: pageNames,
    scale: 1,
  })) changed.push(`${uuid}.json`);

  return { assetPath, uuid, pages: pageNames, changed };
}

function importSpineBinary(assetPath, libraryRoot) {
  if (path.extname(assetPath).toLowerCase() !== '.skel') return null;
  const prepared = prepareSpine(assetPath, libraryRoot);
  const {
    base, atlasText, pageNames, textures, meta, metaPath,
  } = prepared;
  const bytes = fs.readFileSync(assetPath);
  const name = path.basename(base);
  meta.files = ['.bin', '.json'];

  const uuid = meta.uuid;
  const dir = path.join(libraryRoot, uuid.slice(0, 2));
  fs.mkdirSync(dir, { recursive: true });

  const changed = [];
  if (writeJsonIfChanged(metaPath, meta)) changed.push(metaPath);
  if (writeJsonIfChanged(path.join(dir, `${uuid}.json`), {
    __type__: 'sp.SkeletonData',
    _name: name,
    _objFlags: 0,
    __editorExtras__: {},
    _native: '.bin',
    _skeletonJson: null,
    textures,
    textureNames: pageNames,
    scale: 1,
    _atlasText: atlasText,
  })) changed.push(`${uuid}.json`);
  if (writeBytesIfChanged(path.join(dir, `${uuid}.bin`), bytes)) {
    changed.push(`${uuid}.bin`);
  }

  return {
    assetPath,
    uuid,
    pages: pageNames,
    binary: true,
    changed,
  };
}

module.exports = {
  isSpineJson,
  importSpine,
  importSpineBinary,
  atlasPageNames,
};
