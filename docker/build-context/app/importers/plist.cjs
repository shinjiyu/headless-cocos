#!/usr/bin/env node
'use strict';

/**
 * Minimal Cocos Creator 3.8 `.plist` importer for headless preview.
 *
 * A `.plist` is ambiguous — content-based dispatch:
 *   - TexturePacker atlas (`frames` + `metadata`) → cc.SpriteAtlas
 *       library/<xx>/<uuid>.json                cc.SpriteAtlas ({name, spriteFrames[]})
 *       library/<xx>/<uuid>@<sub>.json          cc.SpriteFrame (one per frame)
 *     The atlas page PNG is auto-imported via the image importer; each frame's
 *     SpriteFrame references that page's Texture2D with its rect/offset.
 *   - Cocos2d particle config (`maxParticles`/`emitterType`) → cc.ParticleAsset
 *       library/<xx>/<uuid>.json                cc.ParticleAsset (_native ".plist")
 *       library/<xx>/<uuid>.plist               native config bytes (runtime parses)
 *     The sibling texture named by `textureFileName` is auto-imported and wired
 *     into `ParticleAsset.spriteFrame`, so ParticleSystem2D renders without any
 *     external/remote texture fetch.
 *
 * Engine contracts:
 *   cocos/2d/assets/sprite-atlas.ts  — custom _deserialize({name, spriteFrames:[k,id,...]})
 *   cocos/2d/assets/sprite-frame.ts  — custom serialize wraps fields under `content`
 *   cocos/particle-2d/particle-asset.ts    — plain ccclass, only `spriteFrame`
 *   cocos/particle-2d/particle-system-2d.ts — reads file._nativeAsset (parsed plist)
 *   cocos/asset/asset-manager/{downloader,parser}.ts — `.plist` → downloadText + parsePlist
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { importImage, TEXTURE_ID } = require('./image.cjs');

const PLIST_EXTS = new Set(['.plist']);

// ---- minimal plist XML parser -------------------------------------------
function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

function parsePlist(xml) {
  // Strip prolog, doctype and comments so the tokenizer sees only elements.
  let src = xml
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const plist = src.match(/<plist\b[^>]*>([\s\S]*)<\/plist>/i);
  if (plist) src = plist[1];

  const tokenRe = /<(\/?)([A-Za-z0-9_]+)((?:\s[^>]*?)?)(\/?)>|([^<]+)/g;
  const tokens = [];
  let m;
  while ((m = tokenRe.exec(src)) !== null) {
    if (m[5] !== undefined) {
      tokens.push({ t: 'text', v: m[5] });
    } else {
      const close = m[1] === '/';
      const self = m[4] === '/';
      tokens.push({ t: close ? 'close' : self ? 'self' : 'open', name: m[2].toLowerCase() });
    }
  }

  let i = 0;
  function readText() {
    let out = '';
    while (i < tokens.length && tokens[i].t === 'text') out += tokens[i++].v;
    return decodeEntities(out);
  }
  function parseValue() {
    // skip stray text (whitespace between elements)
    while (i < tokens.length && tokens[i].t === 'text') {
      if (tokens[i].v.trim() !== '') break;
      i++;
    }
    const tok = tokens[i];
    if (!tok) return null;
    if (tok.t === 'self') { i++; return tok.name === 'true' ? true : tok.name === 'false' ? false : null; }
    if (tok.t !== 'open') { i++; return null; }
    const name = tok.name;
    i++; // consume open
    if (name === 'dict') {
      const obj = {};
      for (;;) {
        while (i < tokens.length && tokens[i].t === 'text') i++;
        if (!tokens[i] || tokens[i].t === 'close') { i++; break; }
        // expect <key>
        if (tokens[i].name !== 'key') { i++; continue; }
        i++; // consume <key>
        const key = readText();
        if (tokens[i] && tokens[i].t === 'close') i++; // </key>
        obj[key] = parseValue();
      }
      return obj;
    }
    if (name === 'array') {
      const arr = [];
      for (;;) {
        while (i < tokens.length && tokens[i].t === 'text') i++;
        if (!tokens[i] || tokens[i].t === 'close') { i++; break; }
        arr.push(parseValue());
      }
      return arr;
    }
    // scalar: read text up to matching close
    const text = readText();
    if (tokens[i] && tokens[i].t === 'close') i++; // consume close
    if (name === 'integer') return parseInt(text, 10);
    if (name === 'real') return parseFloat(text);
    if (name === 'true') return true;
    if (name === 'false') return false;
    // string, data, date, key-as-value
    return text;
  }
  return parseValue();
}

function classifyPlist(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.frames && parsed.metadata) return 'sprite-atlas';
  if (
    parsed.maxParticles !== undefined
    || parsed.emitterType !== undefined
    || parsed.particleLifespan !== undefined
  ) return 'particle';
  if (parsed.frames) return 'sprite-atlas';
  return null;
}

// ---- shared io helpers ---------------------------------------------------
function writeJsonIfChanged(file, value) {
  const next = JSON.stringify(value, null, 2);
  try { if (fs.readFileSync(file, 'utf8') === next) return false; } catch {}
  fs.writeFileSync(file, next);
  return true;
}
function writeBytesIfChanged(file, bytes) {
  try { if (Buffer.compare(fs.readFileSync(file), bytes) === 0) return false; } catch {}
  fs.writeFileSync(file, bytes);
  return true;
}
function loadOrInitMeta(metaPath) {
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch { meta = { uuid: crypto.randomUUID() }; }
  if (!/^[0-9a-f-]{36}$/i.test(meta.uuid || '')) throw new Error(`invalid uuid in ${metaPath}`);
  return meta;
}
function nums(str) {
  const list = String(str || '').match(/-?\d+(?:\.\d+)?/g);
  return list ? list.map(Number) : [];
}

// ---- sprite-atlas --------------------------------------------------------
function parseFrame(name, f, format) {
  // Returns {rect, offset, originalSize, rotated}
  if (format >= 3) {
    const r = nums(f.textureRect);       // {{x,y},{w,h}}
    const o = nums(f.spriteOffset);       // {ox,oy}
    const s = nums(f.spriteSourceSize);   // {w,h}
    return {
      rect: { x: r[0] || 0, y: r[1] || 0, width: r[2] || 0, height: r[3] || 0 },
      offset: { x: o[0] || 0, y: o[1] || 0 },
      originalSize: { width: s[0] || 0, height: s[1] || 0 },
      rotated: !!f.textureRotated,
    };
  }
  // format 2 (and 0/1 fallbacks)
  if (f.frame !== undefined) {
    const r = nums(f.frame);              // {{x,y},{w,h}}
    const o = nums(f.offset);             // {ox,oy}
    const s = nums(f.sourceSize);         // {w,h}
    return {
      rect: { x: r[0] || 0, y: r[1] || 0, width: r[2] || 0, height: r[3] || 0 },
      offset: { x: o[0] || 0, y: o[1] || 0 },
      originalSize: { width: s[0] || 0, height: s[1] || 0 },
      rotated: !!f.rotated,
    };
  }
  // format 0: flat numeric keys
  return {
    rect: { x: f.x || 0, y: f.y || 0, width: f.width || 0, height: f.height || 0 },
    offset: { x: f.offsetX || 0, y: f.offsetY || 0 },
    originalSize: { width: f.originalWidth || f.width || 0, height: f.originalHeight || f.height || 0 },
    rotated: !!(f.textureRotated || f.rotated),
  };
}

function subFrameJson(name, atlasUuid, textureUuid, fr) {
  return {
    __type__: 'cc.SpriteFrame',
    content: {
      name,
      atlas: atlasUuid,
      rect: fr.rect,
      offset: fr.offset,
      originalSize: fr.originalSize,
      rotated: fr.rotated,
      capInsets: [0, 0, 0, 0],
      vertices: {
        rawPosition: [], indexes: [], uv: [], nuv: [],
        minPos: { x: 0, y: 0, z: 0 }, maxPos: { x: 0, y: 0, z: 0 },
      },
      texture: textureUuid,
      packable: true,
      pixelsToUnit: 100,
      pivot: { x: 0.5, y: 0.5 },
      meshType: 0,
    },
  };
}

function importSpriteAtlas(assetPath, libraryRoot, parsed) {
  const metaPath = `${assetPath}.meta`;
  const format = (parsed.metadata && Number(parsed.metadata.format)) || 2;
  const texName = (parsed.metadata
    && (parsed.metadata.realTextureFileName || parsed.metadata.textureFileName)) || '';
  if (!texName) throw new Error('sprite-atlas: no texture file in metadata');
  const pagePath = path.join(path.dirname(assetPath), texName);
  if (!fs.existsSync(pagePath)) throw new Error(`sprite-atlas: page image missing: ${texName}`);
  const page = importImage(pagePath, libraryRoot);
  if (!page) throw new Error(`sprite-atlas: unsupported page image: ${texName}`);

  const meta = loadOrInitMeta(metaPath);
  meta.ver ||= '1.0.8';
  meta.importer = 'sprite-atlas';
  meta.imported = true;
  meta.files = ['.json'];
  meta.subMetas ||= {};
  meta.userData = { ...(meta.userData || {}), atlasTextureName: texName, textureUuid: page.textureUuid };

  const uuid = meta.uuid;
  const dir = path.join(libraryRoot, uuid.slice(0, 2));
  fs.mkdirSync(dir, { recursive: true });

  const frameNames = Object.keys(parsed.frames).sort();
  const usedIds = new Set();
  const spriteFramesFlat = []; // [name, subUuid, ...]
  const frameMetaList = [];
  const changed = [];

  for (const name of frameNames) {
    let sub = crypto.createHash('md5').update(name).digest('hex').slice(0, 5);
    while (usedIds.has(sub)) sub = crypto.createHash('md5').update(sub + name).digest('hex').slice(0, 5);
    usedIds.add(sub);
    const subUuid = `${uuid}@${sub}`;
    const fr = parseFrame(name, parsed.frames[name], format);
    if (writeJsonIfChanged(
      path.join(dir, `${subUuid}.json`),
      subFrameJson(name, uuid, page.textureUuid, fr),
    )) changed.push(`${subUuid}.json`);
    spriteFramesFlat.push(name, subUuid);
    frameMetaList.push({ id: sub, uuid: subUuid, name });
    meta.subMetas[sub] = {
      ver: '1.0.12', importer: 'sprite-frame', uuid: subUuid, imported: true,
      files: ['.json'], subMetas: {}, name, displayName: name, id: sub,
      userData: { atlasUuid: uuid, imageUuidOrDatabaseUri: page.textureUuid },
    };
  }

  if (writeJsonIfChanged(metaPath, meta)) changed.push(metaPath);
  if (writeJsonIfChanged(path.join(dir, `${uuid}.json`), {
    __type__: 'cc.SpriteAtlas',
    content: { name: path.basename(assetPath, path.extname(assetPath)), spriteFrames: spriteFramesFlat },
  })) changed.push(`${uuid}.json`);

  return {
    kind: 'sprite-atlas', assetPath, uuid,
    textureUuid: page.textureUuid, pageUuid: page.uuid,
    frames: frameMetaList, changed,
  };
}

// ---- particle ------------------------------------------------------------
function importParticle(assetPath, libraryRoot, parsed) {
  const ext = path.extname(assetPath).toLowerCase();
  const metaPath = `${assetPath}.meta`;
  const bytes = fs.readFileSync(assetPath);
  const name = path.basename(assetPath, ext);

  // Wire the emitter texture through ParticleAsset.spriteFrame so the runtime
  // never has to fetch a remote/relative texture.
  let spriteFrameRef = null;
  let spriteFrameUuid = null;
  const texName = parsed.textureFileName || '';
  if (texName) {
    const texPath = path.join(path.dirname(assetPath), texName);
    if (fs.existsSync(texPath)) {
      const page = importImage(texPath, libraryRoot);
      if (page) {
        spriteFrameUuid = page.spriteFrameUuid;
        spriteFrameRef = { __uuid__: page.spriteFrameUuid, __expectedType__: 'cc.SpriteFrame' };
      }
    }
  }

  const meta = loadOrInitMeta(metaPath);
  meta.ver ||= '1.0.4';
  meta.importer = 'particle';
  meta.imported = true;
  meta.files = ['.json', '.plist'];
  meta.subMetas ||= {};
  meta.userData ||= {};

  const uuid = meta.uuid;
  const dir = path.join(libraryRoot, uuid.slice(0, 2));
  fs.mkdirSync(dir, { recursive: true });

  const changed = [];
  if (writeJsonIfChanged(metaPath, meta)) changed.push(metaPath);
  if (writeJsonIfChanged(path.join(dir, `${uuid}.json`), {
    __type__: 'cc.ParticleAsset',
    _name: name,
    _objFlags: 0,
    __editorExtras__: {},
    _native: '.plist',
    spriteFrame: spriteFrameRef,
  })) changed.push(`${uuid}.json`);
  if (writeBytesIfChanged(path.join(dir, `${uuid}.plist`), bytes)) changed.push(`${uuid}.plist`);

  return { kind: 'particle', assetPath, uuid, spriteFrameUuid, changed };
}

function importPlist(assetPath, libraryRoot, parsedIn) {
  const ext = path.extname(assetPath).toLowerCase();
  if (!PLIST_EXTS.has(ext)) return null;
  let parsed = parsedIn;
  if (!parsed) {
    try { parsed = parsePlist(fs.readFileSync(assetPath, 'utf8')); } catch { return null; }
  }
  const kind = classifyPlist(parsed);
  if (kind === 'sprite-atlas') return importSpriteAtlas(assetPath, libraryRoot, parsed);
  if (kind === 'particle') return importParticle(assetPath, libraryRoot, parsed);
  return null;
}

module.exports = {
  PLIST_EXTS,
  parsePlist,
  classifyPlist,
  importPlist,
};
