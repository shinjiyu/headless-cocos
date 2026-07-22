#!/usr/bin/env node
'use strict';

/**
 * Minimal Cocos Creator 3.8 TTF font importer for headless preview.
 *
 * Library products:
 *   library/<xx>/<uuid>.json           cc.TTFFont (dynamic serialization)
 *   library/<xx>/<uuid>/<name>.ttf     native font bytes (note: subdirectory!)
 *
 * Engine contract (cocos/2d/assets/ttf-font.ts + url-transformer.ts):
 *   - `_native` holds the FILE NAME (e.g. "arial.ttf"), not an extension.
 *   - `_nativeDep` sets `__nativeName__`, and the url combiner appends it as
 *     `<base>/<xx>/<uuid>/<name>.ttf` (WeChat workaround baked into engine).
 *   - the browser's font downloader registers a CSS @font-face from that URL;
 *     TTFFont._fontFamily ends up as "<name>_LABEL".
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FONT_EXTS = new Set(['.ttf']);

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

function importFont(assetPath, libraryRoot) {
  const ext = path.extname(assetPath).toLowerCase();
  if (!FONT_EXTS.has(ext)) return null;

  const bytes = fs.readFileSync(assetPath);
  const name = path.basename(assetPath, ext);
  const nativeName = path.basename(assetPath);
  const metaPath = `${assetPath}.meta`;

  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    meta = { uuid: crypto.randomUUID() };
  }
  if (!/^[0-9a-f-]{36}$/i.test(meta.uuid || '')) {
    throw new Error(`invalid font uuid in ${metaPath}`);
  }
  meta.ver ||= '1.0.0';
  meta.importer = 'ttf-font';
  meta.imported = true;
  meta.files = ['.json', ext];
  meta.subMetas ||= {};
  meta.userData ||= {};

  const uuid = meta.uuid;
  const dir = path.join(libraryRoot, uuid.slice(0, 2));
  const nativeDir = path.join(dir, uuid);
  fs.mkdirSync(nativeDir, { recursive: true });

  const changed = [];
  if (writeJsonIfChanged(metaPath, meta)) changed.push(metaPath);
  if (writeJsonIfChanged(path.join(dir, `${uuid}.json`), {
    __type__: 'cc.TTFFont',
    _name: name,
    _objFlags: 0,
    __editorExtras__: {},
    _native: nativeName,
    _fontFamily: null,
  })) changed.push(`${uuid}.json`);
  if (writeBytesIfChanged(path.join(nativeDir, nativeName), bytes)) {
    changed.push(`${uuid}/${nativeName}`);
  }

  return { assetPath, uuid, ext, nativeName, changed };
}

module.exports = {
  FONT_EXTS,
  importFont,
};
