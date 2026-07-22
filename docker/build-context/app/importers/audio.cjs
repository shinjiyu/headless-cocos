#!/usr/bin/env node
'use strict';

/**
 * Minimal Cocos Creator 3.8 audio importer for headless preview.
 *
 * Library products (matching Creator's audio-clip importer):
 *   library/<xx>/<uuid>.json    cc.AudioClip (dynamic serialization)
 *   library/<xx>/<uuid>.<ext>   native audio bytes
 *
 * The browser resolves the AudioClip JSON via the import path, then the
 * engine's audio-downloader fetches the native bytes (nativeUrl → /native/)
 * and builds the AudioPlayer. Duration is decoded at runtime, so we only
 * serialize it when it is cheap to read (WAV header); 0 is a valid fallback
 * (AudioClip.getDuration falls back to the runtime meta).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.aac', '.m4a']);

function wavDuration(buf) {
  // RIFF/WAVE: fmt chunk carries byteRate; data chunk carries payload size.
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    return 0;
  }
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') byteRate = buf.readUInt32LE(offset + 16);
    if (id === 'data' && byteRate) return size / byteRate;
    offset += 8 + size + (size % 2);
  }
  return 0;
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

function importAudio(assetPath, libraryRoot) {
  const ext = path.extname(assetPath).toLowerCase();
  if (!AUDIO_EXTS.has(ext)) return null;

  const bytes = fs.readFileSync(assetPath);
  const name = path.basename(assetPath, ext);
  const metaPath = `${assetPath}.meta`;

  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    meta = { uuid: crypto.randomUUID() };
  }
  if (!/^[0-9a-f-]{36}$/i.test(meta.uuid || '')) {
    throw new Error(`invalid audio uuid in ${metaPath}`);
  }
  meta.ver ||= '1.0.0';
  meta.importer = 'audio-clip';
  meta.imported = true;
  meta.files = ['.json', ext];
  meta.subMetas ||= {};
  meta.userData = { downloadMode: 0, ...(meta.userData || {}) };

  const uuid = meta.uuid;
  const dir = path.join(libraryRoot, uuid.slice(0, 2));
  fs.mkdirSync(dir, { recursive: true });

  const duration = ext === '.wav' ? wavDuration(bytes) : 0;
  const changed = [];
  if (writeJsonIfChanged(metaPath, meta)) changed.push(metaPath);
  if (writeJsonIfChanged(path.join(dir, `${uuid}.json`), {
    __type__: 'cc.AudioClip',
    _name: name,
    _objFlags: 0,
    __editorExtras__: {},
    _native: ext,
    _duration: duration,
  })) changed.push(`${uuid}.json`);
  if (writeBytesIfChanged(path.join(dir, `${uuid}${ext}`), bytes)) changed.push(`${uuid}${ext}`);

  return { assetPath, uuid, ext, duration, changed };
}

module.exports = {
  AUDIO_EXTS,
  importAudio,
};
