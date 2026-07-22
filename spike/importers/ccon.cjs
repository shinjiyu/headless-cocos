#!/usr/bin/env node
'use strict';

/**
 * Cocos CCON v2 binary codec (notepack document + float chunks).
 * Matches engine `cocos/serialization/ccon.js`.
 */

const { notepackEncode } = require('./_notepack_encode.cjs');
const { notepackDecode } = require('./_notepack_decode.cjs');

const MAGIC = 0x4e4f4343; // 'CCON'
const VERSION = 2;
const CHUNK_ALIGN_AS = 8;

function encodeCCONBinary(document, chunks) {
  const jsonBytes = Buffer.from(notepackEncode(document));
  const parts = [];
  let len = 0;

  function append(buf) {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    parts.push(b);
    len += b.length;
  }

  function alignAs(align) {
    const rem = len % align;
    if (rem !== 0) {
      const pad = align - rem;
      parts.push(Buffer.alloc(pad));
      len += pad;
    }
  }

  const header = Buffer.alloc(12);
  header.writeUInt32LE(MAGIC, 0);
  header.writeUInt32LE(VERSION, 4);
  // total length filled at end
  append(header);

  const docLen = Buffer.alloc(4);
  docLen.writeUInt32LE(jsonBytes.length, 0);
  append(docLen);
  append(jsonBytes);

  for (const chunk of chunks || []) {
    alignAs(CHUNK_ALIGN_AS);
    const cl = Buffer.alloc(4);
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    cl.writeUInt32LE(bytes.length, 0);
    append(cl);
    append(bytes);
  }

  const out = Buffer.concat(parts);
  out.writeUInt32LE(out.length, 8);
  return out;
}

function decodeCCONBinary(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buf.length < 16) throw new Error('CCON too short');
  if (buf.readUInt32LE(0) !== MAGIC) throw new Error('bad CCON magic');
  const version = buf.readUInt32LE(4);
  const total = buf.readUInt32LE(8);
  if (total !== buf.length) throw new Error('CCON length mismatch');
  let p = 12;
  const docLen = buf.readUInt32LE(p);
  p += 4;
  const docBytes = buf.subarray(p, p + docLen);
  p += docLen;
  let document;
  if (version === 2) document = notepackDecode(docBytes);
  else if (version === 1) document = JSON.parse(docBytes.toString('utf8'));
  else throw new Error(`unsupported CCON version ${version}`);

  const chunks = [];
  while (p < buf.length) {
    if (p % CHUNK_ALIGN_AS !== 0) p += CHUNK_ALIGN_AS - (p % CHUNK_ALIGN_AS);
    const cl = buf.readUInt32LE(p);
    p += 4;
    chunks.push(buf.subarray(p, p + cl));
    p += cl;
  }
  return { document, chunks, version };
}

module.exports = {
  encodeCCONBinary,
  decodeCCONBinary,
  MAGIC,
  VERSION,
};
