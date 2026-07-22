#!/usr/bin/env node
'use strict';

/**
 * Minimal Cocos Creator 3.8 BMFont importer for headless preview.
 *
 * Input: assets/**.fnt (BMFont text format) + its page PNG next to it.
 * Output: library/<xx>/<uuid>.json  cc.BitmapFont
 *
 * Engine contract (cocos/2d/assets/bitmap-font.ts, text-processing.ts):
 *   - `spriteFrame`: SpriteFrame dependency of the page image
 *   - `fntConfig.fontDefDictionary[charCode] = {rect, xOffset, yOffset, xAdvance}`
 *   - `fntConfig.kerningDict[(first<<16)|second] = amount`
 *   - `fntConfig.fontSize` feeds style.originFontSize
 * The page PNG is imported through the image importer (same as standalone
 * images), so the SpriteFrame/Texture2D chain already works.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { importImage } = require('./image.cjs');

const BMFONT_EXTS = new Set(['.fnt']);

function parseKV(line) {
  const out = {};
  const re = /([a-zA-Z]+)=("([^"]*)"|[^\s]+)/g;
  let m;
  while ((m = re.exec(line))) {
    out[m[1]] = m[3] !== undefined ? m[3] : m[2];
  }
  return out;
}

function parseFnt(text) {
  const cfg = {
    commonHeight: 0,
    fontSize: 0,
    atlasName: '',
    fontDefDictionary: {},
    kerningDict: {},
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('info')) {
      const kv = parseKV(line);
      cfg.fontSize = Math.abs(Number(kv.size) || 0);
    } else if (line.startsWith('common')) {
      const kv = parseKV(line);
      cfg.commonHeight = Number(kv.lineHeight) || 0;
    } else if (line.startsWith('page')) {
      const kv = parseKV(line);
      if (kv.id === '0' || cfg.atlasName === '') cfg.atlasName = kv.file || '';
    } else if (line.startsWith('char ')) {
      const kv = parseKV(line);
      cfg.fontDefDictionary[Number(kv.id)] = {
        rect: {
          x: Number(kv.x) || 0,
          y: Number(kv.y) || 0,
          width: Number(kv.width) || 0,
          height: Number(kv.height) || 0,
        },
        xOffset: Number(kv.xoffset) || 0,
        yOffset: Number(kv.yoffset) || 0,
        xAdvance: Number(kv.xadvance) || 0,
      };
    } else if (line.startsWith('kerning ')) {
      const kv = parseKV(line);
      const key = ((Number(kv.first) & 0xffff) << 16) | (Number(kv.second) & 0xffff);
      cfg.kerningDict[key] = Number(kv.amount) || 0;
    }
  }
  return cfg;
}

function writeJsonIfChanged(file, value) {
  const next = JSON.stringify(value, null, 2);
  try {
    if (fs.readFileSync(file, 'utf8') === next) return false;
  } catch {}
  fs.writeFileSync(file, next);
  return true;
}

function importBMFont(assetPath, libraryRoot) {
  const ext = path.extname(assetPath).toLowerCase();
  if (!BMFONT_EXTS.has(ext)) return null;

  const text = fs.readFileSync(assetPath, 'utf8');
  const cfg = parseFnt(text);
  if (!cfg.atlasName) throw new Error('fnt has no page file');

  // Make sure the page image is imported so its SpriteFrame uuid exists.
  const pagePath = path.join(path.dirname(assetPath), cfg.atlasName);
  if (!fs.existsSync(pagePath)) throw new Error(`fnt page image missing: ${cfg.atlasName}`);
  const page = importImage(pagePath, libraryRoot);
  if (!page) throw new Error(`unsupported fnt page image: ${cfg.atlasName}`);

  const name = path.basename(assetPath, ext);
  const metaPath = `${assetPath}.meta`;
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    meta = { uuid: crypto.randomUUID() };
  }
  if (!/^[0-9a-f-]{36}$/i.test(meta.uuid || '')) {
    throw new Error(`invalid bmfont uuid in ${metaPath}`);
  }
  meta.ver ||= '1.0.0';
  meta.importer = 'bitmap-font';
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
    __type__: 'cc.BitmapFont',
    _name: name,
    _objFlags: 0,
    __editorExtras__: {},
    _native: '',
    fntDataStr: '',
    spriteFrame: {
      __uuid__: page.spriteFrameUuid,
      __expectedType__: 'cc.SpriteFrame',
    },
    fontSize: cfg.fontSize,
    fntConfig: cfg,
  })) changed.push(`${uuid}.json`);

  return {
    assetPath,
    uuid,
    pageUuid: page.uuid,
    spriteFrameUuid: page.spriteFrameUuid,
    chars: Object.keys(cfg.fontDefDictionary).length,
    changed,
  };
}

module.exports = {
  BMFONT_EXTS,
  importBMFont,
  parseFnt,
};
