#!/usr/bin/env node
'use strict';

/**
 * Minimal Cocos Creator 3.8 text importer for headless preview.
 *
 * TXT / CSV / YAML / CONF / MD → cc.TextAsset
 *
 * Library product (single file, matches Creator's `text` importer):
 *   library/<xx>/<uuid>.json   { __type__: "cc.TextAsset", text: "<contents>" }
 *   assets/**.meta             importer: "text", files: [".json"]
 *
 * The whole file body is embedded as a string — used for i18n tables,
 * config sheets (slot_config, symbol.conf) and similar data files.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TEXT_EXTS = new Set(['.txt', '.csv', '.yaml', '.yml', '.conf', '.md']);

function writeJsonIfChanged(file, value) {
  const next = JSON.stringify(value, null, 2);
  try {
    if (fs.readFileSync(file, 'utf8') === next) return false;
  } catch {}
  fs.writeFileSync(file, next);
  return true;
}

function importText(assetPath, libraryRoot) {
  const ext = path.extname(assetPath).toLowerCase();
  if (!TEXT_EXTS.has(ext)) return null;

  const text = fs.readFileSync(assetPath, 'utf8');
  const name = path.basename(assetPath, ext);
  const metaPath = `${assetPath}.meta`;

  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    meta = { uuid: crypto.randomUUID() };
  }
  if (!/^[0-9a-f-]{36}$/i.test(meta.uuid || '')) {
    throw new Error(`invalid text uuid in ${metaPath}`);
  }
  meta.ver ||= '1.0.0';
  meta.importer = 'text';
  meta.imported = true;
  meta.files = ['.json'];
  meta.subMetas ||= {};
  meta.userData ||= {};

  const uuid = meta.uuid;
  const dir = path.join(libraryRoot, uuid.slice(0, 2));
  fs.mkdirSync(dir, { recursive: true });

  const changed = [];
  if (writeJsonIfChanged(metaPath, meta)) changed.push(metaPath);
  if (writeJsonIfChanged(path.join(dir, `${uuid}.json`), {
    __type__: 'cc.TextAsset',
    _name: name,
    _objFlags: 0,
    __editorExtras__: {},
    _native: '',
    text,
  })) changed.push(`${uuid}.json`);

  return { assetPath, uuid, bytes: text.length, changed };
}

module.exports = {
  TEXT_EXTS,
  importText,
};
