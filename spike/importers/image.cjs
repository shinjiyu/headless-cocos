#!/usr/bin/env node
'use strict';

/**
 * Minimal Cocos Creator 3.8 image importer for headless preview.
 *
 * Produces the same four files used by Creator's preview asset-db:
 *   library/<xx>/<uuid>.json          cc.ImageAsset
 *   library/<xx>/<uuid>.<ext>         native image bytes
 *   library/<xx>/<uuid>@6c48a.json    cc.Texture2D
 *   library/<xx>/<uuid>@f9941.json    cc.SpriteFrame
 *
 * This intentionally implements the untrimmed, unpacked preview path only.
 * It does not perform texture compression, auto-atlas packing, or alpha
 * artifact correction.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TEXTURE_ID = '6c48a';
const SPRITE_FRAME_ID = 'f9941';
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg']);
// cc.ImageAsset `fmt` indexes the engine's extnames table — the browser
// rebuilds the native URL as `<uuid> + extnames[fmt]`, so a wrong index
// 404s (e.g. a .jpg served as .png).
const FMT_BY_EXT = { '.png': '0', '.jpg': '1', '.jpeg': '2', '.bmp': '3', '.webp': '4' };

function readPngInfo(buf) {
  if (buf.length < 26 || buf.toString('hex', 0, 8) !== '89504e470d0a1a0a') {
    throw new Error('invalid PNG');
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const colorType = buf[25];
  return { width, height, hasAlpha: colorType === 4 || colorType === 6 };
}

function readJpegInfo(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    throw new Error('invalid JPEG');
  }
  let offset = 2;
  while (offset + 3 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset++;
      continue;
    }
    while (offset < buf.length && buf[offset] === 0xff) offset++;
    const marker = buf[offset++];
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 1 >= buf.length) break;
    const length = buf.readUInt16BE(offset);
    if (length < 2 || offset + length > buf.length) break;
    // SOF markers carrying dimensions, excluding DHT/JPG/DAC.
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      return {
        width: buf.readUInt16BE(offset + 5),
        height: buf.readUInt16BE(offset + 3),
        hasAlpha: false,
      };
    }
    offset += length;
  }
  throw new Error('JPEG dimensions not found');
}

function readImageInfo(file, bytes) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') return readPngInfo(bytes);
  if (ext === '.jpg' || ext === '.jpeg') return readJpegInfo(bytes);
  throw new Error(`unsupported image extension: ${ext}`);
}

function defaultVertices(width, height) {
  const hw = width / 2;
  const hh = height / 2;
  return {
    rawPosition: [-hw, -hh, 0, hw, -hh, 0, -hw, hh, 0, hw, hh, 0],
    indexes: [0, 1, 2, 2, 1, 3],
    uv: [0, height, width, height, 0, 0, width, 0],
    nuv: [0, 0, 1, 0, 0, 1, 1, 1],
    minPos: [-hw, -hh, 0],
    maxPos: [hw, hh, 0],
  };
}

function makeMeta(uuid, name, ext, info) {
  const textureUuid = `${uuid}@${TEXTURE_ID}`;
  const spriteFrameUuid = `${uuid}@${SPRITE_FRAME_ID}`;
  return {
    ver: '1.0.27',
    importer: 'image',
    imported: true,
    uuid,
    files: ['.json', ext],
    subMetas: {
      [TEXTURE_ID]: {
        ver: '1.0.22',
        importer: 'texture',
        uuid: textureUuid,
        imported: true,
        files: ['.json'],
        subMetas: {},
        userData: {
          wrapModeS: 'clamp-to-edge',
          wrapModeT: 'clamp-to-edge',
          minfilter: 'linear',
          magfilter: 'linear',
          mipfilter: 'none',
          premultiplyAlpha: false,
          anisotropy: 0,
          isUuid: true,
          imageUuidOrDatabaseUri: uuid,
          visible: false,
        },
        displayName: name,
        id: TEXTURE_ID,
        name: 'texture',
      },
      [SPRITE_FRAME_ID]: {
        ver: '1.0.12',
        importer: 'sprite-frame',
        uuid: spriteFrameUuid,
        imported: true,
        files: ['.json'],
        subMetas: {},
        userData: {
          trimType: 'none',
          trimThreshold: 1,
          rotated: false,
          offsetX: 0,
          offsetY: 0,
          trimX: 0,
          trimY: 0,
          width: info.width,
          height: info.height,
          rawWidth: info.width,
          rawHeight: info.height,
          borderTop: 0,
          borderBottom: 0,
          borderLeft: 0,
          borderRight: 0,
          isUuid: true,
          imageUuidOrDatabaseUri: textureUuid,
          atlasUuid: '',
          packable: true,
          vertices: defaultVertices(info.width, info.height),
          pixelsToUnit: 100,
          pivotX: 0.5,
          pivotY: 0.5,
          meshType: 0,
        },
        displayName: name,
        id: SPRITE_FRAME_ID,
        name: 'spriteFrame',
      },
    },
    userData: {
      type: 'sprite-frame',
      redirect: textureUuid,
      hasAlpha: info.hasAlpha,
      fixAlphaTransparencyArtifacts: false,
    },
  };
}

function normalizeMeta(meta, name, ext, info) {
  const uuid = meta.uuid;
  const defaults = makeMeta(uuid, name, ext, info);
  meta.ver ||= defaults.ver;
  meta.importer = 'image';
  meta.imported = true;
  meta.files = ['.json', ext];
  meta.subMetas ||= {};

  for (const id of [TEXTURE_ID, SPRITE_FRAME_ID]) {
    const current = meta.subMetas[id] || {};
    const fallback = defaults.subMetas[id];
    meta.subMetas[id] = {
      ...fallback,
      ...current,
      uuid: `${uuid}@${id}`,
      imported: true,
      files: ['.json'],
      subMetas: current.subMetas || {},
      userData: { ...fallback.userData, ...(current.userData || {}) },
    };
  }

  const sf = meta.subMetas[SPRITE_FRAME_ID].userData;
  // trimType 'auto': Creator computes the alpha-trim rect from pixels at
  // import time and does NOT persist the result back to the meta (the meta's
  // width/trimX numbers can be stale — observed in real projects). We can't
  // decode pixels headlessly, so emit the untrimmed rect: auto-trim only cuts
  // fully-transparent pixels and the offset compensates, so rendering is
  // visually identical. Only 'custom' trim (explicit user rect) is honored,
  // and only while the image still matches rawWidth/rawHeight.
  const customTrimValid =
    sf.trimType === 'custom' &&
    sf.rawWidth === info.width &&
    sf.rawHeight === info.height &&
    typeof sf.width === 'number' &&
    typeof sf.height === 'number' &&
    (sf.trimX || 0) + sf.width <= info.width &&
    (sf.trimY || 0) + sf.height <= info.height;
  if (!customTrimValid) {
    sf.trimX = 0;
    sf.trimY = 0;
    sf.offsetX = 0;
    sf.offsetY = 0;
    sf.width = info.width;
    sf.height = info.height;
    sf.rawWidth = info.width;
    sf.rawHeight = info.height;
    sf.rotated = false;
    sf.vertices = defaultVertices(info.width, info.height);
  } else if (!sf.vertices) {
    sf.vertices = defaultVertices(sf.width, sf.height);
  }
  sf.imageUuidOrDatabaseUri = `${uuid}@${TEXTURE_ID}`;
  meta.subMetas[TEXTURE_ID].userData.imageUuidOrDatabaseUri = uuid;
  meta.userData = {
    ...defaults.userData,
    ...(meta.userData || {}),
    redirect: `${uuid}@${TEXTURE_ID}`,
    hasAlpha: info.hasAlpha,
  };
  return meta;
}

function spriteFrameJson(name, uuid, data, info) {
  const width = data.width ?? info.width;
  const height = data.height ?? info.height;
  const rawWidth = data.rawWidth ?? info.width;
  const rawHeight = data.rawHeight ?? info.height;
  const vertices = data.vertices || defaultVertices(width, height);
  const min = vertices.minPos;
  const max = vertices.maxPos;
  return {
    __type__: 'cc.SpriteFrame',
    content: {
      name,
      atlas: data.atlasUuid || '',
      rect: {
        x: data.trimX || 0,
        y: data.trimY || 0,
        width,
        height,
      },
      offset: {
        x: data.offsetX || 0,
        y: data.offsetY || 0,
      },
      originalSize: {
        width: rawWidth,
        height: rawHeight,
      },
      rotated: !!data.rotated,
      capInsets: [
        data.borderTop || 0,
        data.borderBottom || 0,
        data.borderLeft || 0,
        data.borderRight || 0,
      ],
      vertices: {
        rawPosition: vertices.rawPosition,
        indexes: vertices.indexes,
        uv: vertices.uv,
        nuv: vertices.nuv,
        minPos: { x: min[0], y: min[1], z: min[2] },
        maxPos: { x: max[0], y: max[1], z: max[2] },
      },
      texture: `${uuid}@${TEXTURE_ID}`,
      packable: data.packable !== false,
      pixelsToUnit: data.pixelsToUnit || 100,
      pivot: {
        x: data.pivotX ?? 0.5,
        y: data.pivotY ?? 0.5,
      },
      meshType: data.meshType || 0,
    },
  };
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

function importImage(assetPath, libraryRoot) {
  const ext = path.extname(assetPath).toLowerCase();
  if (!IMAGE_EXTS.has(ext)) return null;

  const bytes = fs.readFileSync(assetPath);
  const info = readImageInfo(assetPath, bytes);
  const name = path.basename(assetPath, ext);
  const metaPath = `${assetPath}.meta`;

  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    meta = { uuid: crypto.randomUUID() };
  }
  if (!/^[0-9a-f-]{36}$/i.test(meta.uuid || '')) {
    throw new Error(`invalid image uuid in ${metaPath}`);
  }
  meta = normalizeMeta(meta, name, ext, info);

  const uuid = meta.uuid;
  const dir = path.join(libraryRoot, uuid.slice(0, 2));
  fs.mkdirSync(dir, { recursive: true });

  const changed = [];
  if (writeJsonIfChanged(metaPath, meta)) changed.push(metaPath);
  if (writeJsonIfChanged(path.join(dir, `${uuid}.json`), {
    __type__: 'cc.ImageAsset',
    content: { fmt: FMT_BY_EXT[ext] ?? '0', w: 0, h: 0 },
  })) changed.push(`${uuid}.json`);
  if (writeBytesIfChanged(path.join(dir, `${uuid}${ext}`), bytes)) changed.push(`${uuid}${ext}`);
  if (writeJsonIfChanged(path.join(dir, `${uuid}@${TEXTURE_ID}.json`), {
    __type__: 'cc.Texture2D',
    content: {
      base: '2,2,2,2,0,0',
      mipmaps: [uuid],
    },
  })) changed.push(`${uuid}@${TEXTURE_ID}.json`);
  if (writeJsonIfChanged(
    path.join(dir, `${uuid}@${SPRITE_FRAME_ID}.json`),
    spriteFrameJson(name, uuid, meta.subMetas[SPRITE_FRAME_ID].userData, info),
  )) changed.push(`${uuid}@${SPRITE_FRAME_ID}.json`);

  return {
    assetPath,
    uuid,
    textureUuid: `${uuid}@${TEXTURE_ID}`,
    spriteFrameUuid: `${uuid}@${SPRITE_FRAME_ID}`,
    width: info.width,
    height: info.height,
    changed,
  };
}

module.exports = {
  IMAGE_EXTS,
  SPRITE_FRAME_ID,
  TEXTURE_ID,
  importImage,
  readImageInfo,
};
