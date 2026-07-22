#!/usr/bin/env node
'use strict';

/**
 * Minimal Cocos Creator 3.8 glTF / GLB importer for headless preview.
 *
 * Scope: meshes (POSITION / NORMAL / TEXCOORD_0 [/ TEXCOORD_1] [/ COLOR_0]
 * [/ TANGENT] [/ JOINTS+WEIGHTS top-4] [/ morph] [/ sparse] [/ meshopt] [/ Draco]),
 * PBR materials (albedo/normal/pbrMap/occlusion/emissive + vertex color +
 * texCoord UV sets + KHR_texture_transform + clearcoat→car-paint + unlit +
 * emissive_strength + ior/specular + anisotropy),
 * full node hierarchy, ExoticAnimation clips, morph-weight tracks, and skins.
 * No lights / cameras (Creator also skips). Transmission still out of scope.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { importImage } = require('./image.cjs');
const { encodeCCONBinary } = require('./ccon.cjs');

const GLTF_EXTS = new Set(['.gltf', '.glb']);
const STANDARD_EFFECT = 'c8f66d17-351a-48da-a12c-0212d28575c4';
// advanced/car-paint.effect — used when KHR_materials_clearcoat is present
const CAR_PAINT_EFFECT = '304a12db-3955-46e4-b712-e5e26f45258b';
// builtin-unlit.effect — used when KHR_materials_unlit is present
const UNLIT_EFFECT = 'a3cd009f-0ab0-420d-9278-b9fdab939bbc';

// Cocos GFX Format enum values used in Mesh._struct
const FMT = { RG32F: 21, RGB32F: 32, RGBA8: 35, RGBA16UI: 42, RGBA32F: 44 };
const PRIM_TRIANGLES = 7;

const COMPONENT = {
  5120: { size: 1, read: (b, o) => b.readInt8(o) },
  5121: { size: 1, read: (b, o) => b.readUInt8(o) },
  5122: { size: 2, read: (b, o) => b.readInt16LE(o) },
  5123: { size: 2, read: (b, o) => b.readUInt16LE(o) },
  5125: { size: 4, read: (b, o) => b.readUInt32LE(o) },
  5126: { size: 4, read: (b, o) => b.readFloatLE(o) },
};
const TYPE_COUNT = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

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

function shortId(kind, index, name) {
  return crypto.createHash('md5').update(`${kind}:${index}:${name || ''}`).digest('hex').slice(0, 5);
}

function fileIdFrom(seed) {
  // Creator stores ~22-char base64url-ish prefab fileIds; we only need stability.
  return crypto.createHash('sha1').update(String(seed)).digest('base64url').slice(0, 22);
}

function djb2(buf) {
  let h = 5381 >>> 0;
  for (let i = 0; i < buf.length; i++) h = (((h << 5) + h) + buf[i]) >>> 0;
  return h >>> 0;
}

function parseGlb(buf) {
  if (buf.length < 12 || buf.toString('utf8', 0, 4) !== 'glTF') {
    throw new Error('invalid GLB magic');
  }
  const version = buf.readUInt32LE(4);
  if (version !== 2) throw new Error(`unsupported GLB version ${version}`);
  let offset = 12;
  let json = null;
  let bin = Buffer.alloc(0);
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    if (end > buf.length) throw new Error('GLB chunk truncated');
    const chunk = buf.slice(start, end);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    else if (type === 0x004e4942) bin = chunk;
    offset = end;
  }
  if (!json) throw new Error('GLB missing JSON chunk');
  const doc = { json, bin, buffers: [bin] };
  return decodeDracoMeshes(flattenDocBuffers(decodeMeshoptViews(doc)));
}

function loadBufferUri(assetPath, bufDesc) {
  if (!bufDesc) return Buffer.alloc(0);
  if (bufDesc.uri) {
    if (bufDesc.uri.startsWith('data:')) {
      const m = bufDesc.uri.match(/^data:[^;]+;base64,(.+)$/);
      if (!m) throw new Error('unsupported data URI buffer');
      return Buffer.from(m[1], 'base64');
    }
    return fs.readFileSync(path.join(path.dirname(assetPath), bufDesc.uri));
  }
  // GLB BIN chunk already assigned externally
  return Buffer.alloc(bufDesc.byteLength || 0);
}

function loadGltf(assetPath) {
  const ext = path.extname(assetPath).toLowerCase();
  if (ext === '.glb') return parseGlb(fs.readFileSync(assetPath));
  const json = JSON.parse(fs.readFileSync(assetPath, 'utf8'));
  const buffers = (json.buffers || []).map((b) => loadBufferUri(assetPath, b));
  const bin = buffers[0] || Buffer.alloc(0);
  const doc = { json, bin, buffers };
  return decodeDracoMeshes(flattenDocBuffers(decodeMeshoptViews(doc)));
}

/**
 * Concatenate all glTF buffers into buffer 0 and rewrite bufferViews.
 * No-op when every view already uses buffer 0 (or there are no views).
 * Runs after meshopt expand; Draco then appends into the same buffer 0.
 */
function flattenDocBuffers(doc) {
  const views = doc.json.bufferViews || [];
  const needs =
    (doc.buffers && doc.buffers.length > 1) ||
    views.some((v) => (v.buffer || 0) !== 0);
  if (!needs) {
    if (doc.buffers && doc.buffers[0] && doc.buffers[0] !== doc.bin) {
      doc.bin = doc.buffers[0];
    }
    return doc;
  }

  const parts = [];
  let offset = 0;
  const baseOf = [];
  const n = Math.max(
    doc.buffers ? doc.buffers.length : 0,
    (doc.json.buffers || []).length,
    1,
  );
  for (let i = 0; i < n; i++) {
    const pad = (4 - (offset % 4)) % 4;
    if (pad) {
      parts.push(Buffer.alloc(pad));
      offset += pad;
    }
    baseOf[i] = offset;
    let buf;
    try {
      buf = getDocBuffer(doc, i);
    } catch {
      buf = Buffer.alloc(0);
    }
    parts.push(buf);
    offset += buf.length;
  }

  for (const view of views) {
    const bi = view.buffer || 0;
    view.buffer = 0;
    view.byteOffset = (baseOf[bi] || 0) + (view.byteOffset || 0);
  }

  const bin = parts.length ? Buffer.concat(parts) : Buffer.alloc(0);
  doc.bin = bin;
  doc.buffers = [bin];
  doc.json.buffers = [{ byteLength: bin.length }];
  return doc;
}

// ---- meshopt (EXT_/KHR_meshopt_compression) ----
let _meshoptDecoder = null;

/** Await once before importing meshopt-compressed glTFs (sync importGltf needs it ready). */
async function prepareMeshopt() {
  if (_meshoptDecoder) return _meshoptDecoder;
  let MeshoptDecoder;
  try {
    ({ MeshoptDecoder } = require('meshoptimizer'));
  } catch (err) {
    throw new Error('meshoptimizer package required for meshopt glTFs: npm i meshoptimizer');
  }
  await MeshoptDecoder.ready;
  if (!MeshoptDecoder.supported) throw new Error('MeshoptDecoder not supported in this runtime');
  _meshoptDecoder = MeshoptDecoder;
  return _meshoptDecoder;
}

// ---- Draco (KHR_draco_mesh_compression) ----
let _dracoModule = null;

/** Await once before importing Draco-compressed glTFs (sync importGltf needs it ready). */
async function prepareDraco() {
  if (_dracoModule) return _dracoModule;
  let createDecoderModule;
  try {
    ({ createDecoderModule } = require('draco3dgltf'));
  } catch (err) {
    throw new Error('draco3dgltf package required for Draco glTFs: npm i draco3dgltf');
  }
  _dracoModule = await createDecoderModule({});
  return _dracoModule;
}

function requireDracoDecoder() {
  if (_dracoModule) return _dracoModule;
  throw new Error(
    'Draco-compressed glTF: call await prepareDraco() before importGltf (or importGltfAsync)',
  );
}

/** Prepare meshopt + Draco decoders (mirror boot / batch imports). */
async function prepareGltfDecoders() {
  await prepareMeshopt();
  await prepareDraco();
}

function docNeedsDraco(json) {
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives || []) {
      if (prim.extensions && prim.extensions.KHR_draco_mesh_compression) return true;
    }
  }
  return false;
}

function gltfTypeFromComponents(n) {
  if (n === 1) return 'SCALAR';
  if (n === 2) return 'VEC2';
  if (n === 3) return 'VEC3';
  if (n === 4) return 'VEC4';
  throw new Error(`draco: unsupported component count ${n}`);
}

/** Append bytes to doc.bin (4-byte aligned); returns byteOffset of the new payload. */
function appendBufferBytes(doc, bytes) {
  const pad = (4 - (doc.bin.length % 4)) % 4;
  const offset = doc.bin.length + pad;
  const parts = pad ? [doc.bin, Buffer.alloc(pad), bytes] : [doc.bin, bytes];
  const bin = Buffer.concat(parts);
  doc.bin = bin;
  doc.buffers = [bin];
  doc.json.buffers = [{ byteLength: bin.length }];
  return offset;
}

function decodeOneDracoPrimitive(doc, prim, ext, module) {
  const views = doc.json.bufferViews || [];
  const view = views[ext.bufferView];
  if (!view) throw new Error(`draco: missing bufferView ${ext.bufferView}`);
  const srcBuf = getDocBuffer(doc, view.buffer);
  const start = view.byteOffset || 0;
  const len = view.byteLength != null ? view.byteLength : 0;
  const data = new Int8Array(srcBuf.buffer, srcBuf.byteOffset + start, len);

  const decoder = new module.Decoder();
  const buffer = new module.DecoderBuffer();
  buffer.Init(data, data.length);

  try {
    const geometryType = decoder.GetEncodedGeometryType(buffer);
    if (geometryType !== module.TRIANGULAR_MESH) {
      throw new Error('draco: only TRIANGULAR_MESH supported');
    }
    const mesh = new module.Mesh();
    const status = decoder.DecodeBufferToMesh(buffer, mesh);
    if (!status.ok() || !mesh.ptr) {
      module.destroy(mesh);
      throw new Error(`draco decode failed: ${status.error_msg()}`);
    }

    try {
      const numPoints = mesh.num_points();
      const numFaces = mesh.num_faces();
      doc.json.accessors = doc.json.accessors || [];
      doc.json.bufferViews = doc.json.bufferViews || [];

      const newAttrs = {};
      for (const [semantic, uniqueId] of Object.entries(ext.attributes || {})) {
        const attribute = decoder.GetAttributeByUniqueId(mesh, uniqueId);
        if (!attribute) throw new Error(`draco: missing attribute uniqueId ${uniqueId} (${semantic})`);
        const numComp = attribute.num_components();
        const values = new module.DracoFloat32Array();
        decoder.GetAttributeFloatForAllPoints(mesh, attribute, values);
        const arr = new Float32Array(numPoints * numComp);
        for (let i = 0; i < arr.length; i++) arr[i] = values.GetValue(i);
        module.destroy(values);

        const bytes = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
        const byteOffset = appendBufferBytes(doc, bytes);
        const bvIndex = doc.json.bufferViews.length;
        doc.json.bufferViews.push({
          buffer: 0,
          byteOffset,
          byteLength: bytes.length,
          byteStride: numComp * 4,
        });
        const accessor = {
          bufferView: bvIndex,
          componentType: 5126,
          count: numPoints,
          type: gltfTypeFromComponents(numComp),
        };
        if (semantic === 'POSITION' && numComp >= 3) {
          const min = [Infinity, Infinity, Infinity];
          const max = [-Infinity, -Infinity, -Infinity];
          for (let i = 0; i < numPoints; i++) {
            for (let c = 0; c < 3; c++) {
              const v = arr[i * 3 + c];
              if (v < min[c]) min[c] = v;
              if (v > max[c]) max[c] = v;
            }
          }
          accessor.min = min;
          accessor.max = max;
        }
        const accIndex = doc.json.accessors.length;
        doc.json.accessors.push(accessor);
        newAttrs[semantic] = accIndex;
      }

      const numIndices = numFaces * 3;
      const indices = new Uint32Array(numIndices);
      for (let f = 0; f < numFaces; f++) {
        const face = new module.DracoInt32Array();
        decoder.GetFaceFromMesh(mesh, f, face);
        indices[f * 3] = face.GetValue(0);
        indices[f * 3 + 1] = face.GetValue(1);
        indices[f * 3 + 2] = face.GetValue(2);
        module.destroy(face);
      }

      const use16 = numPoints <= 65535;
      const ib = Buffer.alloc(numIndices * (use16 ? 2 : 4));
      for (let i = 0; i < numIndices; i++) {
        if (use16) ib.writeUInt16LE(indices[i], i * 2);
        else ib.writeUInt32LE(indices[i], i * 4);
      }
      const ibOff = appendBufferBytes(doc, ib);
      const ibv = doc.json.bufferViews.length;
      doc.json.bufferViews.push({ buffer: 0, byteOffset: ibOff, byteLength: ib.length });
      const iacc = doc.json.accessors.length;
      doc.json.accessors.push({
        bufferView: ibv,
        componentType: use16 ? 5123 : 5125,
        count: numIndices,
        type: 'SCALAR',
      });

      prim.attributes = newAttrs;
      prim.indices = iacc;
    } finally {
      module.destroy(mesh);
    }
  } finally {
    module.destroy(decoder);
    module.destroy(buffer);
  }
}

/**
 * Expand KHR_draco_mesh_compression primitives into dense accessors.
 * Must run after meshopt expand so the Draco bitstream bufferView is readable.
 */
function decodeDracoMeshes(doc) {
  if (!docNeedsDraco(doc.json)) return doc;
  const module = requireDracoDecoder();
  for (const mesh of doc.json.meshes || []) {
    for (const prim of mesh.primitives || []) {
      const ext = prim.extensions && prim.extensions.KHR_draco_mesh_compression;
      if (!ext) continue;
      decodeOneDracoPrimitive(doc, prim, ext, module);
      delete prim.extensions.KHR_draco_mesh_compression;
      if (prim.extensions && !Object.keys(prim.extensions).length) delete prim.extensions;
    }
  }
  return doc;
}

function requireMeshoptDecoder() {
  if (_meshoptDecoder) return _meshoptDecoder;
  throw new Error(
    'meshopt-compressed glTF: call await prepareMeshopt() before importGltf (or importGltfAsync)',
  );
}

function meshoptExt(view) {
  const exts = view && view.extensions;
  if (!exts) return null;
  return exts.EXT_meshopt_compression || exts.KHR_meshopt_compression || null;
}

function getDocBuffer(doc, index) {
  const i = index || 0;
  if (doc.buffers && doc.buffers[i]) return doc.buffers[i];
  if (i === 0 && doc.bin) return doc.bin;
  throw new Error(`missing buffer ${i}`);
}

/**
 * Expand meshopt-compressed bufferViews into a plain buffer 0 so accessors
 * can read densely. No-op when extension absent.
 */
function decodeMeshoptViews(doc) {
  const views = doc.json.bufferViews || [];
  if (!views.some((v) => meshoptExt(v))) return doc;

  const Decoder = requireMeshoptDecoder();
  const parts = [];
  let offset = 0;

  for (const view of views) {
    const pad = (4 - (offset % 4)) % 4;
    if (pad) {
      parts.push(Buffer.alloc(pad));
      offset += pad;
    }
    const ext = meshoptExt(view);
    let bytes;
    if (ext) {
      const srcBuf = getDocBuffer(doc, ext.buffer);
      const srcOff = ext.byteOffset || 0;
      const src = new Uint8Array(srcBuf.buffer, srcBuf.byteOffset + srcOff, ext.byteLength);
      const stride = ext.byteStride || 0;
      if (!stride || !ext.count) throw new Error('meshopt view missing byteStride/count');
      const dst = new Uint8Array(ext.count * stride);
      Decoder.decodeGltfBuffer(
        dst,
        ext.count,
        stride,
        src,
        ext.mode,
        ext.filter || 'NONE',
      );
      bytes = Buffer.from(dst.buffer, dst.byteOffset, dst.byteLength);
      if (view.extensions) {
        delete view.extensions.EXT_meshopt_compression;
        delete view.extensions.KHR_meshopt_compression;
        if (!Object.keys(view.extensions).length) delete view.extensions;
      }
    } else {
      const srcBuf = getDocBuffer(doc, view.buffer);
      const start = view.byteOffset || 0;
      const len = view.byteLength != null ? view.byteLength : 0;
      bytes = Buffer.from(srcBuf.buffer, srcBuf.byteOffset + start, len);
    }
    view.buffer = 0;
    view.byteOffset = offset;
    view.byteLength = bytes.length;
    parts.push(bytes);
    offset += bytes.length;
  }

  const bin = parts.length ? Buffer.concat(parts) : Buffer.alloc(0);
  doc.bin = bin;
  doc.buffers = [bin];
  doc.json.buffers = [{ byteLength: bin.length }];
  return doc;
}

/** Async import that prepares meshopt / Draco decoders as needed. */
async function importGltfAsync(assetPath, libraryRoot, options) {
  const peekExt = path.extname(assetPath).toLowerCase();
  let needsMeshopt = false;
  let needsDraco = false;
  try {
    let json;
    if (peekExt === '.glb') {
      ({ json } = parseGlbRaw(fs.readFileSync(assetPath)));
    } else {
      json = JSON.parse(fs.readFileSync(assetPath, 'utf8'));
    }
    needsMeshopt = (json.bufferViews || []).some((v) => meshoptExt(v));
    needsDraco = docNeedsDraco(json);
  } catch {
    needsMeshopt = true; // prepare anyway if peek fails
    needsDraco = true;
  }
  if (needsMeshopt) await prepareMeshopt();
  if (needsDraco) await prepareDraco();
  return importGltf(assetPath, libraryRoot, options);
}

/** Parse GLB without meshopt expand (for peeking). */
function parseGlbRaw(buf) {
  if (buf.length < 12 || buf.toString('utf8', 0, 4) !== 'glTF') {
    throw new Error('invalid GLB magic');
  }
  const version = buf.readUInt32LE(4);
  if (version !== 2) throw new Error(`unsupported GLB version ${version}`);
  let offset = 12;
  let json = null;
  let bin = Buffer.alloc(0);
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    if (end > buf.length) throw new Error('GLB chunk truncated');
    const chunk = buf.slice(start, end);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    else if (type === 0x004e4942) bin = chunk;
    offset = end;
  }
  if (!json) throw new Error('GLB missing JSON chunk');
  return { json, bin, buffers: [bin] };
}

function bufferViewByteBase(doc, bufferViewIndex, byteOffset = 0) {
  const view = doc.json.bufferViews[bufferViewIndex];
  if (!view) throw new Error(`missing bufferView ${bufferViewIndex}`);
  // After flattenDocBuffers / meshopt, views live in buffers[0] === bin.
  if ((view.buffer || 0) !== 0) {
    throw new Error('bufferView not on buffer 0 (call flattenDocBuffers first)');
  }
  return (view.byteOffset || 0) + (byteOffset || 0);
}

function accessorInfo(doc, accessorIndex) {
  const acc = doc.json.accessors[accessorIndex];
  if (!acc) throw new Error(`missing accessor ${accessorIndex}`);
  const count = TYPE_COUNT[acc.type];
  if (!count) throw new Error(`unsupported accessor type ${acc.type}`);
  const comp = COMPONENT[acc.componentType];
  if (!comp) throw new Error(`unsupported componentType ${acc.componentType}`);
  if (acc.bufferView == null) {
    // Allowed when sparse is present — initialize with zeros then overlay.
    if (!acc.sparse) throw new Error(`accessor ${accessorIndex} has no bufferView`);
    return { acc, count, comp, base: null, stride: null, view: null };
  }
  const view = doc.json.bufferViews[acc.bufferView];
  if (!view) throw new Error(`missing bufferView ${acc.bufferView}`);
  if ((view.buffer || 0) !== 0) {
    throw new Error('only buffer 0 supported (flattenDocBuffers should run first)');
  }
  const base = (view.byteOffset || 0) + (acc.byteOffset || 0);
  const stride = view.byteStride || comp.size * count;
  return { acc, count, comp, base, stride, view };
}

function normalizeComponent(componentType, value) {
  switch (componentType) {
    case 5120: return Math.max(value / 127, -1); // BYTE
    case 5121: return value / 255; // UNSIGNED_BYTE
    case 5122: return Math.max(value / 32767, -1); // SHORT
    case 5123: return value / 65535; // UNSIGNED_SHORT
    default: return value;
  }
}

/** Overlay accessor.sparse onto a typed array (Float32 or Uint32). */
function applySparse(doc, acc, out, components, { asFloat }) {
  const sparse = acc.sparse;
  if (!sparse || !sparse.count) return;
  const indicesComp = COMPONENT[sparse.indices.componentType];
  if (!indicesComp) throw new Error(`unsupported sparse indices type ${sparse.indices.componentType}`);
  const valuesComp = COMPONENT[acc.componentType];
  const idxBase = bufferViewByteBase(doc, sparse.indices.bufferView, sparse.indices.byteOffset || 0);
  const valBase = bufferViewByteBase(doc, sparse.values.bufferView, sparse.values.byteOffset || 0);
  const idxStride = indicesComp.size;
  const valStride = valuesComp.size * components;
  const normalized = !!acc.normalized;
  for (let s = 0; s < sparse.count; s++) {
    const index = indicesComp.read(doc.bin, idxBase + s * idxStride) >>> 0;
    if (index >= acc.count) throw new Error(`sparse index ${index} out of range ${acc.count}`);
    for (let c = 0; c < components; c++) {
      let v = valuesComp.read(doc.bin, valBase + s * valStride + c * valuesComp.size);
      if (asFloat && normalized) v = normalizeComponent(acc.componentType, v);
      out[index * components + c] = v;
    }
  }
}

function readAccessor(doc, accessorIndex) {
  const { acc, count, comp, base, stride } = accessorInfo(doc, accessorIndex);
  const out = new Float32Array(acc.count * count);
  const normalized = !!acc.normalized;
  if (base != null) {
    for (let i = 0; i < acc.count; i++) {
      const row = base + i * stride;
      for (let c = 0; c < count; c++) {
        let v = comp.read(doc.bin, row + c * comp.size);
        if (normalized) v = normalizeComponent(acc.componentType, v);
        out[i * count + c] = v;
      }
    }
  }
  applySparse(doc, acc, out, count, { asFloat: true });
  return {
    values: out,
    count: acc.count,
    components: count,
    min: acc.min,
    max: acc.max,
    normalized,
  };
}

/** COLOR_0 as float RGBA (pads alpha=1 when VEC3). */
function readColorRGBA(doc, accessorIndex, nVert) {
  const acc = readAccessor(doc, accessorIndex);
  const out = new Float32Array(nVert * 4);
  const c = acc.components;
  for (let i = 0; i < nVert; i++) {
    if (c >= 3) {
      out[i * 4] = acc.values[i * c] || 0;
      out[i * 4 + 1] = acc.values[i * c + 1] || 0;
      out[i * 4 + 2] = acc.values[i * c + 2] || 0;
      out[i * 4 + 3] = c >= 4 ? (acc.values[i * c + 3] || 0) : 1;
    } else {
      out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = out[i * 4 + 3] = 1;
    }
  }
  return out;
}

function readIndices(doc, accessorIndex) {
  const { acc, count, comp, base, stride } = accessorInfo(doc, accessorIndex);
  if (count !== 1) throw new Error('indices must be SCALAR');
  const out = new Uint32Array(acc.count);
  if (base != null) {
    for (let i = 0; i < acc.count; i++) {
      out[i] = comp.read(doc.bin, base + i * stride);
    }
  }
  applySparse(doc, acc, out, 1, { asFloat: false });
  return out;
}

/** Collect JOINTS_n / WEIGHTS_n sets (n = 0,1,… contiguous). */
function collectJointWeightSets(doc, attrs) {
  const sets = [];
  for (let n = 0; ; n++) {
    const jKey = `JOINTS_${n}`;
    const wKey = `WEIGHTS_${n}`;
    if (attrs[jKey] == null || attrs[wKey] == null) break;
    sets.push({
      joints: readAccessor(doc, attrs[jKey]).values,
      weights: readAccessor(doc, attrs[wKey]).values,
    });
  }
  return sets;
}

/**
 * Creator behaviour: merge all JOINTS_n / WEIGHTS_n and keep the 4 heaviest
 * influences as a_joints / a_weights (no a_joints1).
 */
function top4Influences(sets, vertIndex) {
  const pairs = [];
  for (const s of sets) {
    for (let c = 0; c < 4; c++) {
      pairs.push({
        j: s.joints[vertIndex * 4 + c] | 0,
        w: s.weights[vertIndex * 4 + c] || 0,
      });
    }
  }
  pairs.sort((a, b) => b.w - a.w || a.j - b.j);
  const top = pairs.slice(0, 4);
  while (top.length < 4) top.push({ j: 0, w: 0 });
  return top;
}

function buildPrimitiveBuffers(doc, primitive) {
  const attrs = primitive.attributes || {};
  if (attrs.POSITION == null) throw new Error('primitive missing POSITION');
  const pos = readAccessor(doc, attrs.POSITION);
  const nVert = pos.count;
  const nor = attrs.NORMAL != null
    ? readAccessor(doc, attrs.NORMAL)
    : { values: new Float32Array(nVert * 3) };
  const uv = attrs.TEXCOORD_0 != null
    ? readAccessor(doc, attrs.TEXCOORD_0)
    : { values: new Float32Array(nVert * 2) };
  let tanValues;
  if (attrs.TANGENT != null) {
    tanValues = readAccessor(doc, attrs.TANGENT).values;
  } else {
    tanValues = new Float32Array(nVert * 4);
    for (let i = 0; i < nVert; i++) {
      tanValues[i * 4] = 1;
      tanValues[i * 4 + 3] = 1;
    }
  }

  const hasColor = attrs.COLOR_0 != null;
  const colorValues = hasColor
    ? readColorRGBA(doc, attrs.COLOR_0, nVert)
    : null;
  const hasUv1 = attrs.TEXCOORD_1 != null;
  const uv1 = hasUv1
    ? readAccessor(doc, attrs.TEXCOORD_1)
    : null;

  const jointSets = collectJointWeightSets(doc, attrs);
  const skinned = jointSets.length > 0;
  let maxJointIndex = -1;
  if (skinned) {
    for (const s of jointSets) {
      for (let i = 0; i < s.joints.length; i++) {
        const j = s.joints[i] | 0;
        if (j > maxJointIndex) maxJointIndex = j;
      }
    }
  }

  // Layout: pos(12)+nor(12)+uv0(8)+tan(16) [=48]
  //       + [color(16)] + [uv1(8)] + [joints(8)+weights(16)]
  let stride = 48;
  const colorOff = hasColor ? stride : -1;
  if (hasColor) stride += 16;
  const uv1Off = hasUv1 ? stride : -1;
  if (hasUv1) stride += 8;
  const jointsOff = skinned ? stride : -1;
  if (skinned) stride += 24;

  const vb = Buffer.alloc(nVert * stride);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < nVert; i++) {
    const o = i * stride;
    const px = pos.values[i * 3], py = pos.values[i * 3 + 1], pz = pos.values[i * 3 + 2];
    vb.writeFloatLE(px, o);
    vb.writeFloatLE(py, o + 4);
    vb.writeFloatLE(pz, o + 8);
    vb.writeFloatLE(nor.values[i * 3] || 0, o + 12);
    vb.writeFloatLE(nor.values[i * 3 + 1] || 0, o + 16);
    vb.writeFloatLE(nor.values[i * 3 + 2] || 0, o + 20);
    vb.writeFloatLE(uv.values[i * 2] || 0, o + 24);
    vb.writeFloatLE(uv.values[i * 2 + 1] || 0, o + 28);
    vb.writeFloatLE(tanValues[i * 4] || 1, o + 32);
    vb.writeFloatLE(tanValues[i * 4 + 1] || 0, o + 36);
    vb.writeFloatLE(tanValues[i * 4 + 2] || 0, o + 40);
    vb.writeFloatLE(tanValues[i * 4 + 3] || 1, o + 44);
    if (hasColor) {
      const c = i * 4;
      vb.writeFloatLE(colorValues[c], o + colorOff);
      vb.writeFloatLE(colorValues[c + 1], o + colorOff + 4);
      vb.writeFloatLE(colorValues[c + 2], o + colorOff + 8);
      vb.writeFloatLE(colorValues[c + 3], o + colorOff + 12);
    }
    if (hasUv1) {
      vb.writeFloatLE(uv1.values[i * 2] || 0, o + uv1Off);
      vb.writeFloatLE(uv1.values[i * 2 + 1] || 0, o + uv1Off + 4);
    }
    if (skinned) {
      const top = top4Influences(jointSets, i);
      vb.writeUInt16LE(top[0].j, o + jointsOff);
      vb.writeUInt16LE(top[1].j, o + jointsOff + 2);
      vb.writeUInt16LE(top[2].j, o + jointsOff + 4);
      vb.writeUInt16LE(top[3].j, o + jointsOff + 6);
      vb.writeFloatLE(top[0].w, o + jointsOff + 8);
      vb.writeFloatLE(top[1].w, o + jointsOff + 12);
      vb.writeFloatLE(top[2].w, o + jointsOff + 16);
      vb.writeFloatLE(top[3].w, o + jointsOff + 20);
    }
    if (px < minX) minX = px; if (py < minY) minY = py; if (pz < minZ) minZ = pz;
    if (px > maxX) maxX = px; if (py > maxY) maxY = py; if (pz > maxZ) maxZ = pz;
  }

  let indices;
  if (primitive.indices != null) indices = readIndices(doc, primitive.indices);
  else {
    indices = new Uint32Array(nVert);
    for (let i = 0; i < nVert; i++) indices[i] = i;
  }
  let maxIndex = 0;
  for (let i = 0; i < indices.length; i++) if (indices[i] > maxIndex) maxIndex = indices[i];
  const use32 = maxIndex > 65535;
  const ib = Buffer.alloc(indices.length * (use32 ? 4 : 2));
  for (let i = 0; i < indices.length; i++) {
    if (use32) ib.writeUInt32LE(indices[i], i * 4);
    else ib.writeUInt16LE(indices[i], i * 2);
  }
  return {
    vb,
    ib,
    nVert,
    indexCount: indices.length,
    indexStride: use32 ? 4 : 2,
    materialIndex: primitive.material != null ? primitive.material : 0,
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    skinned,
    hasColor,
    hasUv1,
    maxJointIndex,
    stride,
  };
}

/** Build one cc.Mesh from a glTF mesh (all primitives). Optional skin → jointMaps. */
function buildMeshFromGltfMesh(doc, gltfMesh, skin) {
  const prims = gltfMesh.primitives || [];
  if (!prims.length) throw new Error('mesh has no primitives');

  const built = prims.map((p) => buildPrimitiveBuffers(doc, p));
  const vertexBundles = [];
  const primitives = [];
  const parts = [];
  let offset = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let triangleCount = 0;
  const anySkinned = built.some((b) => b.skinned);

  for (let i = 0; i < built.length; i++) {
    const b = built[i];
    const vbOffset = offset;
    parts.push(b.vb);
    offset += b.vb.length;
    const ibOffset = offset;
    parts.push(b.ib);
    offset += b.ib.length;

    const attributes = [
      { name: 'a_position', format: FMT.RGB32F, isNormalized: false },
      { name: 'a_normal', format: FMT.RGB32F, isNormalized: false },
      { name: 'a_texCoord', format: FMT.RG32F, isNormalized: false },
      { name: 'a_tangent', format: FMT.RGBA32F, isNormalized: false },
    ];
    if (b.hasColor) {
      attributes.push({ name: 'a_color', format: FMT.RGBA32F, isNormalized: false });
    }
    if (b.hasUv1) {
      attributes.push({ name: 'a_texCoord1', format: FMT.RG32F, isNormalized: false });
    }
    if (b.skinned) {
      attributes.push(
        { name: 'a_joints', format: FMT.RGBA16UI, isNormalized: false },
        { name: 'a_weights', format: FMT.RGBA32F, isNormalized: false },
      );
    }
    vertexBundles.push({
      view: { offset: vbOffset, length: b.vb.length, count: b.nVert, stride: b.stride },
      attributes,
    });
    const prim = {
      primitiveMode: PRIM_TRIANGLES,
      vertexBundelIndices: [i],
      indexView: {
        offset: ibOffset,
        length: b.ib.length,
        count: b.indexCount,
        stride: b.indexStride,
      },
    };
    if (b.skinned) prim.jointMapIndex = 0;
    primitives.push(prim);
    triangleCount += Math.floor(b.indexCount / 3);
    if (b.min[0] < minX) minX = b.min[0];
    if (b.min[1] < minY) minY = b.min[1];
    if (b.min[2] < minZ) minZ = b.min[2];
    if (b.max[0] > maxX) maxX = b.max[0];
    if (b.max[1] > maxY) maxY = b.max[1];
    if (b.max[2] > maxZ) maxZ = b.max[2];
  }

  // Morph targets: append Float32 VEC3 displacement views after VB/IB.
  const ATTR_MAP = {
    POSITION: 'a_position',
    NORMAL: 'a_normal',
    TANGENT: 'a_tangent',
  };
  const subMeshMorphs = [];
  let anyMorph = false;
  for (let pi = 0; pi < prims.length; pi++) {
    const targets = prims[pi].targets || [];
    if (!targets.length) {
      subMeshMorphs.push(null);
      continue;
    }
    const nVert = built[pi].nVert;
    // Prefer POSITION; include NORMAL/TANGENT when present on all targets.
    const attrKeys = ['POSITION'];
    if (targets.every((t) => t.NORMAL != null)) attrKeys.push('NORMAL');
    if (targets.every((t) => t.TANGENT != null)) attrKeys.push('TANGENT');
    // Skip morph if no POSITION on any target
    if (!targets.some((t) => t.POSITION != null)) {
      subMeshMorphs.push(null);
      continue;
    }
    const morphTargets = [];
    for (const t of targets) {
      const displacements = [];
      for (const key of attrKeys) {
        const accIndex = t[key];
        let floats;
        if (accIndex == null) {
          floats = new Float32Array(nVert * 3);
        } else {
          const acc = readAccessor(doc, accIndex);
          // TANGENT morph in glTF is VEC3 deltas (not VEC4)
          const need = nVert * 3;
          floats = new Float32Array(need);
          const src = acc.values;
          const copy = Math.min(src.length, need);
          floats.set(src.subarray(0, copy));
        }
        const viewOffset = offset;
        const bytes = Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength);
        parts.push(bytes);
        offset += bytes.length;
        displacements.push({
          offset: viewOffset,
          length: bytes.length,
          count: floats.length,
          stride: 12,
        });
      }
      morphTargets.push({ displacements });
    }
    subMeshMorphs.push({
      attributes: attrKeys.map((k) => ATTR_MAP[k]),
      targets: morphTargets,
      weights: Array.isArray(gltfMesh.weights) ? gltfMesh.weights.slice() : undefined,
    });
    anyMorph = true;
  }

  const bin = Buffer.concat(parts);
  const meshStruct = {
    primitives,
    vertexBundles,
    minPosition: { __type__: 'cc.Vec3', x: minX, y: minY, z: minZ },
    maxPosition: { __type__: 'cc.Vec3', x: maxX, y: maxY, z: maxZ },
  };
  if (anySkinned) {
    let nJoints = skin && Array.isArray(skin.joints) ? skin.joints.length : 0;
    if (!nJoints) {
      nJoints = Math.max(-1, ...built.map((b) => b.maxJointIndex)) + 1;
    }
    meshStruct.jointMaps = [Array.from({ length: nJoints }, (_, i) => i)];
  }
  if (anyMorph) {
    const morph = { subMeshMorphs };
    if (Array.isArray(gltfMesh.weights) && gltfMesh.weights.length) {
      morph.weights = gltfMesh.weights.slice();
    }
    const names = gltfMesh.extras && gltfMesh.extras.targetNames;
    if (Array.isArray(names) && names.length) morph.targetNames = names.slice();
    meshStruct.morph = morph;
  }
  const meshJson = {
    __type__: 'cc.Mesh',
    _name: '',
    _objFlags: 0,
    __editorExtras__: {},
    _native: '.bin',
    _struct: meshStruct,
    _hash: djb2(bin),
    _allowDataAccess: true,
  };
  const materialIndices = built.map((b) => b.materialIndex);
  return {
    bin,
    meshJson,
    materialIndices,
    triangleCount,
    skinned: anySkinned,
    morph: anyMorph,
  };
}

function quatFromGltf(node) {
  if (node.rotation && node.rotation.length === 4) {
    const [x, y, z, w] = node.rotation;
    return { __type__: 'cc.Quat', x, y, z, w };
  }
  return { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 };
}

function vec3From(arr, fallback) {
  if (arr && arr.length >= 3) {
    return { __type__: 'cc.Vec3', x: arr[0], y: arr[1], z: arr[2] };
  }
  return { __type__: 'cc.Vec3', x: fallback[0], y: fallback[1], z: fallback[2] };
}

/** Resolve glTF node local TRS, including mat4 bake when present. */
function nodeLocalTRS(node) {
  if (node.matrix && node.matrix.length === 16) {
    const m = node.matrix;
    const t = { __type__: 'cc.Vec3', x: m[12], y: m[13], z: m[14] };
    const sx = Math.hypot(m[0], m[1], m[2]) || 1;
    const sy = Math.hypot(m[4], m[5], m[6]) || 1;
    const sz = Math.hypot(m[8], m[9], m[10]) || 1;
    const r00 = m[0] / sx, r10 = m[1] / sx, r20 = m[2] / sx;
    const r01 = m[4] / sy, r11 = m[5] / sy, r21 = m[6] / sy;
    const r02 = m[8] / sz, r12 = m[9] / sz, r22 = m[10] / sz;
    const trace = r00 + r11 + r22;
    let qx, qy, qz, qw;
    if (trace > 0) {
      const s = Math.sqrt(trace + 1) * 2;
      qw = 0.25 * s; qx = (r21 - r12) / s; qy = (r02 - r20) / s; qz = (r10 - r01) / s;
    } else if (r00 > r11 && r00 > r22) {
      const s = Math.sqrt(1 + r00 - r11 - r22) * 2;
      qw = (r21 - r12) / s; qx = 0.25 * s; qy = (r01 + r10) / s; qz = (r02 + r20) / s;
    } else if (r11 > r22) {
      const s = Math.sqrt(1 + r11 - r00 - r22) * 2;
      qw = (r02 - r20) / s; qx = (r01 + r10) / s; qy = 0.25 * s; qz = (r12 + r21) / s;
    } else {
      const s = Math.sqrt(1 + r22 - r00 - r11) * 2;
      qw = (r10 - r01) / s; qx = (r02 + r20) / s; qy = (r12 + r21) / s; qz = 0.25 * s;
    }
    return {
      pos: t,
      rot: { __type__: 'cc.Quat', x: qx, y: qy, z: qz, w: qw },
      scale: { __type__: 'cc.Vec3', x: sx, y: sy, z: sz },
    };
  }
  return {
    pos: vec3From(node.translation, [0, 0, 0]),
    rot: quatFromGltf(node),
    scale: vec3From(node.scale, [1, 1, 1]),
  };
}

function makeMeshRenderer(nodeId, meshUuid, materialUuids, bakeId, compPrefabId) {
  return {
    __type__: 'cc.MeshRenderer',
    _name: '',
    _objFlags: 0,
    __editorExtras__: {},
    node: { __id__: nodeId },
    _enabled: true,
    __prefab: { __id__: compPrefabId },
    _materials: (materialUuids || []).filter(Boolean).map((u) => ({
      __uuid__: u,
      __expectedType__: 'cc.Material',
    })),
    _visFlags: 0,
    bakeSettings: { __id__: bakeId },
    _mesh: { __uuid__: meshUuid, __expectedType__: 'cc.Mesh' },
    _shadowCastingMode: 0,
    _shadowReceivingMode: 1,
    _shadowBias: 0,
    _shadowNormalBias: 0,
    _reflectionProbeId: -1,
    _reflectionProbeBlendId: -1,
    _reflectionProbeBlendWeight: 0,
    _enabledGlobalStandardSkinObject: false,
    _enableMorph: true,
    _id: '',
  };
}

function makeSkinnedMeshRenderer(nodeId, meshUuid, skeletonUuid, skinningRootId, materialUuids, bakeId, compPrefabId) {
  return {
    __type__: 'cc.SkinnedMeshRenderer',
    _name: '',
    _objFlags: 0,
    __editorExtras__: {},
    node: { __id__: nodeId },
    _enabled: true,
    __prefab: { __id__: compPrefabId },
    _materials: (materialUuids || []).filter(Boolean).map((u) => ({
      __uuid__: u,
      __expectedType__: 'cc.Material',
    })),
    _visFlags: 0,
    bakeSettings: { __id__: bakeId },
    _mesh: { __uuid__: meshUuid, __expectedType__: 'cc.Mesh' },
    _shadowCastingMode: 0,
    _shadowReceivingMode: 1,
    _shadowBias: 0,
    _shadowNormalBias: 0,
    _reflectionProbeId: -1,
    _reflectionProbeBlendId: -1,
    _reflectionProbeBlendWeight: 0,
    _enabledGlobalStandardSkinObject: false,
    _enableMorph: true,
    _skeleton: { __uuid__: skeletonUuid, __expectedType__: 'cc.Skeleton' },
    _skinningRoot: { __id__: skinningRootId },
    _id: '',
  };
}

/** Build cc.Skeleton JSON from a glTF skin (joints paths + inverseBindMatrices). */
function buildSkeletonJson(doc, skinIndex) {
  const skin = (doc.json.skins || [])[skinIndex];
  if (!skin) throw new Error(`missing skin ${skinIndex}`);
  const joints = (skin.joints || []).map((ji) => gltfNodePath(doc, ji));
  const bindposes = [];
  if (skin.inverseBindMatrices != null) {
    const ibm = readAccessor(doc, skin.inverseBindMatrices);
    for (let i = 0; i < ibm.count; i++) {
      const o = i * 16;
      const m = ibm.values;
      bindposes.push({
        __type__: 'cc.Mat4',
        m00: m[o], m01: m[o + 1], m02: m[o + 2], m03: m[o + 3],
        m04: m[o + 4], m05: m[o + 5], m06: m[o + 6], m07: m[o + 7],
        m08: m[o + 8], m09: m[o + 9], m10: m[o + 10], m11: m[o + 11],
        m12: m[o + 12], m13: m[o + 13], m14: m[o + 14], m15: m[o + 15],
      });
    }
  }
  while (bindposes.length < joints.length) {
    bindposes.push({
      __type__: 'cc.Mat4',
      m00: 1, m01: 0, m02: 0, m03: 0,
      m04: 0, m05: 1, m06: 0, m07: 0,
      m08: 0, m09: 0, m10: 1, m11: 0,
      m12: 0, m13: 0, m14: 0, m15: 1,
    });
  }
  return {
    __type__: 'cc.Skeleton',
    _name: skin.name || `Skin-${skinIndex}`,
    _objFlags: 0,
    __editorExtras__: {},
    _native: '',
    _joints: joints,
    _bindposes: bindposes,
    _hash: 0,
  };
}

function makeBakeSettings() {
  return {
    __type__: 'cc.ModelBakeSettings',
    texture: null,
    uvParam: { __type__: 'cc.Vec4', x: 0, y: 0, z: 0, w: 0 },
    _bakeable: false,
    _castShadow: false,
    _receiveShadow: false,
    _recieveShadow: false,
    _lightmapSize: 64,
    _useLightProbe: false,
    _bakeToLightProbe: true,
    _reflectionProbeType: 0,
    _bakeToReflectionProbe: true,
  };
}

/** Collect every node index under the default scene (DFS). */
function collectSceneNodeIndices(doc) {
  const nodes = doc.json.nodes || [];
  const scenes = doc.json.scenes || [];
  const scene = scenes[doc.json.scene || 0] || scenes[0] || { nodes: nodes.length ? [0] : [] };
  const roots = scene.nodes && scene.nodes.length ? scene.nodes : (nodes.length ? [0] : []);
  const out = [];
  const walk = (i) => {
    out.push(i);
    for (const c of (nodes[i].children || [])) walk(c);
  };
  for (const r of roots) walk(r);
  return out;
}

/** Path from glTF scene-root down to node (ExoticAnimation path under wrapper). */
function gltfNodePath(doc, nodeIndex) {
  const nodes = doc.json.nodes || [];
  const parentOf = new Map();
  nodes.forEach((n, i) => {
    for (const c of n.children || []) parentOf.set(c, i);
  });
  const parts = [];
  let cur = nodeIndex;
  while (cur != null) {
    parts.unshift(nodes[cur].name || `node_${cur}`);
    cur = parentOf.has(cur) ? parentOf.get(cur) : null;
  }
  return parts.join('/');
}

/**
 * Build one gltf-animation CCON (cc.AnimationClip + ExoticAnimation).
 * Every scene node gets constant TRS; channels override with keyframes.
 */
function buildAnimationClipCcon(doc, animIndex, sample) {
  const anim = (doc.json.animations || [])[animIndex];
  if (!anim) throw new Error(`missing animation ${animIndex}`);

  const channelsByNode = new Map();
  let duration = 0;
  const weightChannels = []; // { node, times, values, targetCount }
  for (const ch of anim.channels || []) {
    if (ch.target == null || ch.target.node == null) continue;
    const pathName = ch.target.path;
    const sampler = (anim.samplers || [])[ch.sampler];
    if (!sampler) continue;
    const times = readAccessor(doc, sampler.input).values;
    const values = readAccessor(doc, sampler.output).values;
    if (times.length) duration = Math.max(duration, times[times.length - 1]);

    if (pathName === 'weights') {
      weightChannels.push({ node: ch.target.node, times, values });
      continue;
    }
    if (pathName !== 'translation' && pathName !== 'rotation' && pathName !== 'scale') continue;
    let slot = channelsByNode.get(ch.target.node);
    if (!slot) {
      slot = {};
      channelsByNode.set(ch.target.node, slot);
    }
    slot[pathName] = { times, values };
  }
  if (duration <= 0) duration = 1 / (sample || 30);

  const nodeIndices = collectSceneNodeIndices(doc);
  const document = [];
  const floatParts = [];
  let byteOffset = 0;

  function pushFloats(arr) {
    const f32 = arr instanceof Float32Array ? arr : Float32Array.from(arr);
    const ref = {
      __type__: 'TypedArrayRef',
      ctor: 'Float32Array',
      offset: byteOffset,
      length: f32.length,
    };
    floatParts.push(Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength));
    byteOffset += f32.byteLength;
    return ref;
  }

  function makeTrack(timesArr, valuesArr, valuesType) {
    const trackId = document.length;
    document.push({
      __type__: 'cc.animation.ExoticTrack',
      times: pushFloats(timesArr),
      values: { __id__: trackId + 1 },
    });
    document.push({
      __type__: valuesType,
      _values: pushFloats(valuesArr),
      _isQuantized: false,
    });
    return trackId;
  }

  document.push(null); // [0] clip placeholder
  const exoticId = document.length;
  document.push({
    __type__: 'cc.animation.ExoticAnimation',
    _nodeAnimations: [],
  });

  for (const ni of nodeIndices) {
    const trs = nodeLocalTRS(doc.json.nodes[ni]);
    const ch = channelsByNode.get(ni) || {};
    const nodeAnimId = document.length;
    const nodeAnim = {
      __type__: 'cc.animation.ExoticNodeAnimation',
      _path: gltfNodePath(doc, ni),
    };
    document.push(nodeAnim);
    document[exoticId]._nodeAnimations.push({ __id__: nodeAnimId });

    if (ch.translation) {
      nodeAnim._position = {
        __id__: makeTrack(ch.translation.times, ch.translation.values, 'cc.animation.ExoticVec3TrackValues'),
      };
    } else {
      nodeAnim._position = {
        __id__: makeTrack(
          new Float32Array([0]),
          new Float32Array([trs.pos.x, trs.pos.y, trs.pos.z]),
          'cc.animation.ExoticVec3TrackValues',
        ),
      };
    }
    if (ch.rotation) {
      nodeAnim._rotation = {
        __id__: makeTrack(ch.rotation.times, ch.rotation.values, 'cc.animation.ExoticQuatTrackValues'),
      };
    } else {
      nodeAnim._rotation = {
        __id__: makeTrack(
          new Float32Array([0]),
          new Float32Array([trs.rot.x, trs.rot.y, trs.rot.z, trs.rot.w]),
          'cc.animation.ExoticQuatTrackValues',
        ),
      };
    }
    if (ch.scale) {
      nodeAnim._scale = {
        __id__: makeTrack(ch.scale.times, ch.scale.values, 'cc.animation.ExoticVec3TrackValues'),
      };
    } else {
      nodeAnim._scale = {
        __id__: makeTrack(
          new Float32Array([0]),
          new Float32Array([trs.scale.x, trs.scale.y, trs.scale.z]),
          'cc.animation.ExoticVec3TrackValues',
        ),
      };
    }
  }

  const additiveId = document.length;
  document.push({
    __type__: 'cc.AnimationClipAdditiveSettings',
    enabled: false,
    refClip: null,
  });

  // Morph weight tracks (RealArrayTrack + MorphWeightsAllValueProxy)
  const trackRefs = [];
  for (const wc of weightChannels) {
    const node = doc.json.nodes[wc.node];
    if (!node || node.mesh == null) continue;
    const mesh = doc.json.meshes[node.mesh];
    const nTargets = ((mesh.primitives || [])[0] && (mesh.primitives[0].targets || []).length) || 0;
    if (!nTargets) continue;
    const nFrames = wc.times.length;
    const pathStr = gltfNodePath(doc, wc.node);
    const compName = node.skin != null ? 'cc.SkinnedMeshRenderer' : 'cc.MeshRenderer';

    const channelIds = [];
    for (let ti = 0; ti < nTargets; ti++) {
      const curveId = document.length;
      const times = [];
      const values = [];
      for (let f = 0; f < nFrames; f++) {
        times.push(wc.times[f]);
        values.push({
          __type__: 'cc.RealKeyframeValue',
          interpolationMode: 0,
          tangentWeightMode: 0,
          value: wc.values[f * nTargets + ti] || 0,
          rightTangent: 0,
          rightTangentWeight: 1,
          leftTangent: 0,
          leftTangentWeight: 1,
          easingMethod: 0,
        });
      }
      document.push({
        __type__: 'cc.RealCurve',
        _times: times,
        _values: values,
        preExtrapolation: 1,
        postExtrapolation: 1,
      });
      const chId = document.length;
      document.push({
        __type__: 'cc.animation.Channel',
        _curve: { __id__: curveId },
      });
      channelIds.push(chId);
    }

    const hierId = document.length;
    document.push({
      __type__: 'cc.animation.HierarchyPath',
      path: pathStr,
    });
    const compId = document.length;
    document.push({
      __type__: 'cc.animation.ComponentPath',
      component: compName,
    });
    const pathId = document.length;
    document.push({
      __type__: 'cc.animation.TrackPath',
      _paths: [{ __id__: hierId }, { __id__: compId }],
    });
    const proxyId = document.length;
    document.push({
      __type__: 'cc.animation.MorphWeightsAllValueProxy',
    });
    const trackId = document.length;
    document.push({
      __type__: 'cc.animation.RealArrayTrack',
      _binding: {
        __type__: 'cc.animation.TrackBinding',
        path: { __id__: pathId },
        proxy: { __id__: proxyId },
      },
      _channels: channelIds.map((id) => ({ __id__: id })),
    });
    trackRefs.push({ __id__: trackId });
  }

  document[0] = {
    __type__: 'cc.AnimationClip',
    _name: anim.name || `animation_${animIndex}`,
    _objFlags: 0,
    __editorExtras__: {},
    _native: '',
    sample: sample || 30,
    speed: 1,
    wrapMode: 2,
    enableTrsBlending: true,
    _duration: duration,
    _hash: 0,
    _tracks: trackRefs,
    _exoticAnimation: { __id__: exoticId },
    _events: [],
    _embeddedPlayers: [],
    _additiveSettings: { __id__: additiveId },
    _auxiliaryCurveEntries: [],
  };

  return {
    name: document[0]._name,
    duration,
    bin: encodeCCONBinary(document, [Buffer.concat(floatParts)]),
  };
}

/**
 * Build a Creator-style gltf-scene prefab:
 *   Prefab → outer wrapper → glTF hierarchy with MeshRenderer or SkinnedMeshRenderer.
 *   Clips → cc.Animation (static) or cc.SkeletalAnimation (when skins present).
 */
function buildHierarchyPrefab(
  doc,
  meshIds,
  materialIds,
  meshMaterialSlots,
  seed,
  fallbackName,
  clipUuids,
  skeletonIds,
) {
  const nodes = doc.json.nodes || [];
  const scenes = doc.json.scenes || [];
  const scene = scenes[doc.json.scene || 0] || scenes[0] || { nodes: nodes.length ? [0] : [], name: fallbackName };
  const sceneName = scene.name || fallbackName || 'Root';
  const rootIndices = scene.nodes && scene.nodes.length ? scene.nodes : (nodes.length ? [0] : []);
  const hasSkeletons = Array.isArray(skeletonIds) && skeletonIds.some(Boolean);

  const out = [];
  out.push({
    __type__: 'cc.Prefab',
    _name: '',
    _objFlags: 0,
    __editorExtras__: {},
    _native: '',
    data: { __id__: 1 },
    optimizationPolicy: 0,
    persistent: false,
  });

  // Map glTF node index → object id in `out` (filled as we emit).
  const nodeObjId = new Map();
  // Pending child link patches: { parentObjId, childGltfIndex }
  const childLinks = [];

  function emitNode(gltfIndex, parentObjId) {
    const n = nodes[gltfIndex] || { name: `node_${gltfIndex}` };
    const objId = out.length;
    nodeObjId.set(gltfIndex, objId);

    const children = n.children || [];
    const childRefs = children.map((ci) => {
      childLinks.push({ parentObjId: objId, childGltfIndex: ci });
      return { __id__: -1 }; // patched later
    });

    const trs = nodeLocalTRS(n);
    const hasMesh = n.mesh != null && meshIds[n.mesh];
    const comps = [];
    out.push({
      __type__: 'cc.Node',
      _name: n.name || `node_${gltfIndex}`,
      _objFlags: 0,
      __editorExtras__: {},
      _parent: parentObjId == null ? null : { __id__: parentObjId },
      _children: childRefs,
      _active: true,
      _components: comps,
      _prefab: null, // filled later
      _lpos: trs.pos,
      _lrot: trs.rot,
      _lscale: trs.scale,
      _mobility: 0,
      _layer: 1073741824,
      _euler: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
      _id: '',
    });

    if (hasMesh) {
      const meshUuid = meshIds[n.mesh];
      const slots = meshMaterialSlots[n.mesh] || [0];
      const mats = slots.map((mi) => materialIds[mi] || materialIds[0] || null);
      const mrId = out.length;
      const bakeId = mrId + 1;
      const compInfoId = mrId + 2;
      comps.push({ __id__: mrId });
      const skelUuid = n.skin != null && skeletonIds ? skeletonIds[n.skin] : null;
      if (skelUuid) {
        out.push(makeSkinnedMeshRenderer(objId, meshUuid, skelUuid, wrapperId, mats, bakeId, compInfoId));
      } else {
        out.push(makeMeshRenderer(objId, meshUuid, mats, bakeId, compInfoId));
      }
      out.push(makeBakeSettings());
      out.push({ __type__: 'cc.CompPrefabInfo', fileId: fileIdFrom(`${seed}:mr:${gltfIndex}`) });
    }

    for (const ci of children) emitNode(ci, objId);
  }

  // Outer wrapper (Creator always adds one)
  const wrapperId = out.length; // 1
  const sceneRootRefs = rootIndices.map(() => ({ __id__: -1 }));
  out.push({
    __type__: 'cc.Node',
    _name: sceneName,
    _objFlags: 0,
    __editorExtras__: {},
    _parent: null,
    _children: sceneRootRefs,
    _active: true,
    _components: [],
    _prefab: null,
    _lpos: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
    _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 },
    _lscale: { __type__: 'cc.Vec3', x: 1, y: 1, z: 1 },
    _mobility: 0,
    _layer: 1073741824,
    _euler: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
    _id: '',
  });

  rootIndices.forEach((ri, i) => {
    emitNode(ri, wrapperId);
    sceneRootRefs[i].__id__ = nodeObjId.get(ri);
  });

  // Patch child __id__ placeholders
  for (const link of childLinks) {
    const parent = out[link.parentObjId];
    const childId = nodeObjId.get(link.childGltfIndex);
    const slot = parent._children.find((c) => c.__id__ === -1);
    if (slot) slot.__id__ = childId;
  }

  if ((clipUuids && clipUuids.length) || hasSkeletons) {
    const animId = out.length;
    const compInfoId = animId + 1;
    out[wrapperId]._components.push({ __id__: animId });
    const clips = clipUuids || [];
    const defaultUuid = clips[0] || null;
    if (hasSkeletons) {
      out.push({
        __type__: 'cc.SkeletalAnimation',
        _name: '',
        _objFlags: 0,
        __editorExtras__: {},
        node: { __id__: wrapperId },
        _enabled: true,
        __prefab: { __id__: compInfoId },
        playOnLoad: false,
        _clips: clips.map((u) => ({
          __uuid__: u,
          __expectedType__: 'cc.AnimationClip',
        })),
        _defaultClip: defaultUuid
          ? { __uuid__: defaultUuid, __expectedType__: 'cc.AnimationClip' }
          : null,
        _useBakedAnimation: true,
        _sockets: [],
        _id: '',
      });
    } else {
      out.push({
        __type__: 'cc.Animation',
        _name: '',
        _objFlags: 0,
        __editorExtras__: {},
        node: { __id__: wrapperId },
        _enabled: true,
        __prefab: { __id__: compInfoId },
        playOnLoad: false,
        _clips: clips.map((u) => ({
          __uuid__: u,
          __expectedType__: 'cc.AnimationClip',
        })),
        _defaultClip: defaultUuid
          ? { __uuid__: defaultUuid, __expectedType__: 'cc.AnimationClip' }
          : null,
        _id: '',
      });
    }
    out.push({ __type__: 'cc.CompPrefabInfo', fileId: fileIdFrom(`${seed}:anim`) });
  }

  // PrefabInfo for every node
  for (let i = 1; i < out.length; i++) {
    if (out[i].__type__ !== 'cc.Node') continue;
    const infoId = out.length;
    out[i]._prefab = { __id__: infoId };
    out.push({
      __type__: 'cc.PrefabInfo',
      root: { __id__: 1 },
      asset: { __id__: 0 },
      fileId: fileIdFrom(`${seed}:node:${i}`),
      instance: null,
      targetOverrides: null,
      nestedPrefabInstanceRoots: null,
    });
  }

  return out;
}

function ensureImageAsset(imagePath, libraryRoot, changed) {
  const r = importImage(imagePath, libraryRoot);
  if (!r) throw new Error(`image import failed: ${imagePath}`);
  if (r.changed && r.changed.length) changed.push(...r.changed);
  return r.uuid;
}

function writeEmbeddedImage(assetPath, doc, imageIndex, changed) {
  const img = doc.json.images[imageIndex];
  if (!img) throw new Error(`missing image ${imageIndex}`);
  const dir = path.dirname(assetPath);
  if (img.uri && !img.uri.startsWith('data:')) {
    return path.join(dir, img.uri);
  }
  let bytes;
  let ext = '.png';
  if (img.uri && img.uri.startsWith('data:')) {
    const m = img.uri.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) throw new Error('bad data URI image');
    if (m[1].includes('jpeg') || m[1].includes('jpg')) ext = '.jpg';
    bytes = Buffer.from(m[2], 'base64');
  } else if (img.bufferView != null) {
    const view = doc.json.bufferViews[img.bufferView];
    const src = getDocBuffer(doc, view.buffer || 0);
    const start = view.byteOffset || 0;
    bytes = Buffer.from(src.buffer, src.byteOffset + start, view.byteLength);
    if ((img.mimeType || '').includes('jpeg')) ext = '.jpg';
  } else {
    throw new Error(`image ${imageIndex} has no uri/bufferView`);
  }
  const out = path.join(dir, `._gltf_embed_${imageIndex}${ext}`);
  if (writeBytesIfChanged(out, bytes)) changed.push(out);
  // Ensure a stable meta uuid for embedded extracts
  const metaPath = `${out}.meta`;
  if (!fs.existsSync(metaPath)) {
    writeJsonIfChanged(metaPath, {
      ver: '1.0.27',
      importer: 'image',
      imported: true,
      uuid: crypto.randomUUID(),
      files: ['.json', ext],
      subMetas: {},
      userData: { type: 'sprite-frame' },
    });
  }
  return out;
}

function texRef(uuid) {
  return { __uuid__: uuid, __expectedType__: 'cc.Texture2D' };
}

function colorFromFactor(factor, fallback) {
  const f = factor && factor.length >= 3 ? factor : fallback;
  return {
    __type__: 'cc.Color',
    r: Math.round(Math.min(1, Math.max(0, f[0])) * 255),
    g: Math.round(Math.min(1, Math.max(0, f[1])) * 255),
    b: Math.round(Math.min(1, Math.max(0, f[2])) * 255),
    a: Math.round(Math.min(1, Math.max(0, f[3] != null ? f[3] : 1)) * 255),
  };
}

/** Dielectric F0 from IOR: ((n-1)/(n+1))^2. Default ior 1.5 → 0.04. */
function f0FromIor(ior) {
  const n = ior != null ? ior : 1.5;
  const t = (n - 1) / (n + 1);
  return t * t;
}

/**
 * Map KHR_materials_ior + KHR_materials_specular → specularIntensity.
 * Creator default specularIntensity 0.5 ≈ F0(1.5)/0.08.
 */
function specularIntensityFromExtensions(mat) {
  const exts = mat.extensions || {};
  const iorExt = exts.KHR_materials_ior;
  const specExt = exts.KHR_materials_specular;
  if (!iorExt && !specExt) return null;

  const ior = iorExt && iorExt.ior != null ? iorExt.ior : 1.5;
  const f0 = f0FromIor(ior);
  let intensity = f0 / 0.08;
  if (specExt) {
    const factor = specExt.specularFactor != null ? specExt.specularFactor : 1;
    intensity *= factor;
  }
  if (intensity < 0) intensity = 0;
  if (intensity > 1) intensity = 1;
  return intensity;
}

function texCoordUvName(texInfo) {
  const set = texInfo && texInfo.texCoord != null ? texInfo.texCoord : 0;
  return set === 1 ? 'v_uv1' : 'v_uv';
}

/** KHR_texture_transform → Creator tilingOffset (scale.xy, offset.zw). Rotation ignored. */
function tilingOffsetFromTextureInfo(texInfo) {
  const ext =
    texInfo &&
    texInfo.extensions &&
    texInfo.extensions.KHR_texture_transform;
  if (!ext) return null;
  const scale = Array.isArray(ext.scale) ? ext.scale : [1, 1];
  const offset = Array.isArray(ext.offset) ? ext.offset : [0, 0];
  return {
    __type__: 'cc.Vec4',
    x: scale[0] != null ? scale[0] : 1,
    y: scale[1] != null ? scale[1] : 1,
    z: offset[0] != null ? offset[0] : 0,
    w: offset[1] != null ? offset[1] : 0,
  };
}

/** Alpha / cull state shared by standard, car-paint, and unlit materials. */
function materialAlphaAndCull(mat, defines) {
  const cullMode = mat.doubleSided ? 0 : 1;
  if (mat.doubleSided) defines[0].USE_TWOSIDE = true;

  let techIdx = 0;
  let blendState = { targets: [{}] };
  let depthStencilState = {};
  if (mat.alphaMode === 'MASK') {
    defines[0].USE_ALPHA_TEST = true;
  } else if (mat.alphaMode === 'BLEND') {
    techIdx = 1;
    depthStencilState = { depthTest: true, depthWrite: false };
    blendState = {
      targets: [{
        blend: true,
        blendSrc: 2, // SRC_ALPHA
        blendDst: 4, // ONE_MINUS_SRC_ALPHA
        blendDstAlpha: 4,
      }],
    };
  }
  return { cullMode, techIdx, blendState, depthStencilState };
}

/**
 * KHR_materials_unlit → builtin-unlit (baseColor only, USE_TEXTURE).
 */
function materialJsonUnlit(mat, textureIds, options = {}) {
  const pbr = mat.pbrMetallicRoughness || {};
  const props = {
    tilingOffset: { __type__: 'cc.Vec4', x: 1, y: 1, z: 0, w: 0 },
    mainColor: colorFromFactor(pbr.baseColorFactor, [1, 1, 1, 1]),
  };
  const defines = [{}];
  if (options.useVertexColor) defines[0].USE_VERTEX_COLOR = true;

  const albedoInfo = pbr.baseColorTexture;
  const albedoIdx = albedoInfo && albedoInfo.index;
  if (albedoIdx != null && textureIds[albedoIdx]) {
    props.mainTexture = texRef(textureIds[albedoIdx]);
    defines[0].USE_TEXTURE = true;
    const to = tilingOffsetFromTextureInfo(albedoInfo);
    if (to) props.tilingOffset = to;
  }
  if (mat.alphaMode === 'MASK') {
    props.alphaThreshold = mat.alphaCutoff != null ? mat.alphaCutoff : 0.5;
  }

  const { cullMode, techIdx, blendState, depthStencilState } = materialAlphaAndCull(mat, defines);
  // unlit effect has no USE_TWOSIDE define — cull still applied via rasterizerState
  delete defines[0].USE_TWOSIDE;

  return {
    __type__: 'cc.Material',
    _name: mat.name || '',
    _objFlags: 0,
    __editorExtras__: {},
    _native: '',
    _effectAsset: {
      __uuid__: UNLIT_EFFECT,
      __expectedType__: 'cc.EffectAsset',
    },
    _techIdx: techIdx,
    _defines: defines,
    _states: [{
      rasterizerState: { cullMode },
      blendState,
      depthStencilState,
    }],
    _props: [props],
  };
}

/**
 * Build Material from a glTF material (builtin-standard, unlit, or car-paint).
 * Maps:
 *   KHR_materials_unlit → builtin-unlit (baseColor / USE_TEXTURE)
 *   baseColorTexture → mainTexture / USE_ALBEDO_MAP (+ ALBEDO_UV)
 *   normalTexture → normalMap / USE_NORMAL_MAP (+ NORMAL_UV)
 *   metallicRoughnessTexture → pbrMap / USE_PBR_MAP  (R=AO G=rough B=metal)
 *   occlusionTexture → occlusionMap / USE_OCCLUSION_MAP (if separate from pbrMap)
 *   emissiveTexture → emissiveMap / USE_EMISSIVE_MAP (+ EMISSIVE_UV)
 *   texCoord=1 → HAS_SECOND_UV + v_uv1 macros
 *   KHR_texture_transform on baseColor → tilingOffset
 *   KHR_materials_clearcoat → car-paint effect + coatRoughness / coatIntensity
 *   KHR_materials_emissive_strength → emissiveScale
 *   KHR_materials_ior / specular → specularIntensity
 *   KHR_materials_anisotropy → IS_ANISOTROPY + anisotropyIntensity/Rotation
 *
 * @param {object} mat glTF material
 * @param {string[]} textureIds texture sub-uuids by glTF texture index
 */
function materialJson(mat, textureIds, options = {}) {
  if (mat.extensions && mat.extensions.KHR_materials_unlit) {
    return materialJsonUnlit(mat, textureIds, options);
  }

  const pbr = mat.pbrMetallicRoughness || {};
  const props = {
    tilingOffset: { __type__: 'cc.Vec4', x: 1, y: 1, z: 0, w: 0 },
    mainColor: colorFromFactor(pbr.baseColorFactor, [1, 1, 1, 1]),
    metallic: pbr.metallicFactor != null ? pbr.metallicFactor : 1,
    roughness: pbr.roughnessFactor != null ? pbr.roughnessFactor : 1,
    occlusion: 1,
    normalStrength: 1,
  };
  const defines = [{}];
  let needsSecondUv = false;
  let effectUuid = STANDARD_EFFECT;

  if (options.useVertexColor) {
    defines[0].USE_VERTEX_COLOR = true;
  }

  const albedoInfo = pbr.baseColorTexture;
  const albedoIdx = albedoInfo && albedoInfo.index;
  if (albedoIdx != null && textureIds[albedoIdx]) {
    props.mainTexture = texRef(textureIds[albedoIdx]);
    defines[0].USE_ALBEDO_MAP = true;
    const uv = texCoordUvName(albedoInfo);
    defines[0].ALBEDO_UV = uv;
    if (uv === 'v_uv1') needsSecondUv = true;
    const to = tilingOffsetFromTextureInfo(albedoInfo);
    if (to) props.tilingOffset = to;
  }

  const normal = mat.normalTexture;
  if (normal && normal.index != null && textureIds[normal.index]) {
    props.normalMap = texRef(textureIds[normal.index]);
    defines[0].USE_NORMAL_MAP = true;
    const uv = texCoordUvName(normal);
    defines[0].NORMAL_UV = uv;
    if (uv === 'v_uv1') needsSecondUv = true;
    if (normal.scale != null) props.normalStrength = normal.scale;
  }

  const mrInfo = pbr.metallicRoughnessTexture;
  const mrIdx = mrInfo && mrInfo.index;
  if (mrIdx != null && textureIds[mrIdx]) {
    props.pbrMap = texRef(textureIds[mrIdx]);
    defines[0].USE_PBR_MAP = true;
    // pbrMap uses DEFAULT_UV in effect — set when texCoord=1
    const uv = texCoordUvName(mrInfo);
    defines[0].DEFAULT_UV = uv;
    if (uv === 'v_uv1') needsSecondUv = true;
  }

  const occ = mat.occlusionTexture;
  if (occ && occ.index != null && textureIds[occ.index]) {
    // Separate AO map (when packed into ORM/pbrMap, Creator prefers USE_PBR_MAP only)
    if (mrIdx == null || occ.index !== mrIdx) {
      props.occlusionMap = texRef(textureIds[occ.index]);
      defines[0].USE_OCCLUSION_MAP = true;
    }
    if (occ.strength != null) props.occlusion = occ.strength;
    if (texCoordUvName(occ) === 'v_uv1') needsSecondUv = true;
  }

  const emissive = mat.emissiveTexture;
  if (emissive && emissive.index != null && textureIds[emissive.index]) {
    props.emissiveMap = texRef(textureIds[emissive.index]);
    defines[0].USE_EMISSIVE_MAP = true;
    const uv = texCoordUvName(emissive);
    defines[0].EMISSIVE_UV = uv;
    if (uv === 'v_uv1') needsSecondUv = true;
  }
  if (mat.emissiveFactor && mat.emissiveFactor.length >= 3) {
    props.emissive = colorFromFactor(
      [mat.emissiveFactor[0], mat.emissiveFactor[1], mat.emissiveFactor[2], 1],
      [0, 0, 0, 1],
    );
  }
  const emissiveStrengthExt =
    mat.extensions && mat.extensions.KHR_materials_emissive_strength;
  if (emissiveStrengthExt && emissiveStrengthExt.emissiveStrength != null) {
    const s = emissiveStrengthExt.emissiveStrength;
    props.emissiveScale = {
      __type__: 'cc.Vec3',
      x: s,
      y: s,
      z: s,
    };
  }

  const specularIntensity = specularIntensityFromExtensions(mat);
  if (specularIntensity != null) {
    props.specularIntensity = specularIntensity;
  }

  // KHR_materials_anisotropy
  const aniso = mat.extensions && mat.extensions.KHR_materials_anisotropy;
  if (aniso) {
    defines[0].IS_ANISOTROPY = true;
    props.anisotropyIntensity =
      aniso.anisotropyStrength != null ? aniso.anisotropyStrength : 0;
    // Creator: anisotropyRotation in [0,1] → radians * PI; glTF is radians
    const rotRad = aniso.anisotropyRotation != null ? aniso.anisotropyRotation : 0;
    props.anisotropyRotation = rotRad / Math.PI;
    const anisoTex = aniso.anisotropyTexture;
    if (anisoTex && anisoTex.index != null && textureIds[anisoTex.index]) {
      props.anisotropyMap = texRef(textureIds[anisoTex.index]);
      defines[0].USE_ANISOTROPY_MAP = true;
      if (texCoordUvName(anisoTex) === 'v_uv1') needsSecondUv = true;
    }
  }

  if (needsSecondUv) {
    defines[0].HAS_SECOND_UV = true;
  }

  // KHR_materials_clearcoat → advanced/car-paint (builtin-standard has no coat)
  const clearcoat =
    mat.extensions && mat.extensions.KHR_materials_clearcoat;
  if (clearcoat) {
    effectUuid = CAR_PAINT_EFFECT;
    // Drop emissive / anisotropy — car-paint has no those paths
    delete defines[0].USE_EMISSIVE_MAP;
    delete defines[0].EMISSIVE_UV;
    delete defines[0].IS_ANISOTROPY;
    delete defines[0].USE_ANISOTROPY_MAP;
    delete props.emissiveMap;
    delete props.emissive;
    delete props.emissiveScale;
    delete props.anisotropyIntensity;
    delete props.anisotropyRotation;
    delete props.anisotropyMap;

    props.coatRoughness =
      clearcoat.clearcoatRoughnessFactor != null
        ? clearcoat.clearcoatRoughnessFactor
        : 0;
    props.coatIntensity =
      clearcoat.clearcoatFactor != null ? clearcoat.clearcoatFactor : 0;
    props.coatOpacity = 1;
    props.coatIOR = 1.5;
    props.coatColor = {
      __type__: 'cc.Color',
      r: 255,
      g: 255,
      b: 255,
      a: 255,
    };

    // Creator coatDataMap: R=roughness G=intensity B=opacity (≠ glTF packing).
    // Prefer clearcoatRoughnessTexture; fall back to clearcoatTexture.
    const coatTex =
      clearcoat.clearcoatRoughnessTexture || clearcoat.clearcoatTexture;
    if (coatTex && coatTex.index != null && textureIds[coatTex.index]) {
      props.coatDataMap = texRef(textureIds[coatTex.index]);
      defines[0].USE_COAT_DATA_MAP = true;
    }
  }

  if (mat.alphaMode === 'MASK') {
    props.alphaThreshold = mat.alphaCutoff != null ? mat.alphaCutoff : 0.5;
  }

  const { cullMode, techIdx, blendState, depthStencilState } = materialAlphaAndCull(mat, defines);

  return {
    __type__: 'cc.Material',
    _name: mat.name || '',
    _objFlags: 0,
    __editorExtras__: {},
    _native: '',
    _effectAsset: {
      __uuid__: effectUuid,
      __expectedType__: 'cc.EffectAsset',
    },
    _techIdx: techIdx,
    _defines: defines,
    _states: [{
      rasterizerState: { cullMode },
      blendState,
      depthStencilState,
    }],
    _props: [props],
  };
}

function textureJson(imageUuid, wrapS, wrapT) {
  // Texture2D.content.base: wrapS,wrapT,min,mag,mip,anisotropy  (Creator packing)
  // 1 = REPEAT, 0 = CLAMP roughly — Kenney uses repeat+nearest → "1,1,0,0,1,0"
  const ws = wrapS === 33071 /* CLAMP_TO_EDGE */ ? 0 : 1;
  const wt = wrapT === 33071 ? 0 : 1;
  return {
    __type__: 'cc.Texture2D',
    content: {
      base: `${ws},${wt},0,0,1,0`,
      mipmaps: [imageUuid],
    },
  };
}

function findExistingSubId(meta, importer, gltfIndex, nameHint) {
  const subs = meta.subMetas || {};
  for (const [id, sub] of Object.entries(subs)) {
    if (sub.importer !== importer) continue;
    if (
      gltfIndex != null
      && sub.userData
      && sub.userData.gltfIndex === gltfIndex
    ) {
      return id;
    }
    if (nameHint && sub.name === nameHint) return id;
  }
  return null;
}

function importGltf(assetPath, libraryRoot) {
  const ext = path.extname(assetPath).toLowerCase();
  if (!GLTF_EXTS.has(ext)) return null;

  const doc = loadGltf(assetPath);
  const baseName = path.basename(assetPath, ext);
  const metaPath = `${assetPath}.meta`;
  const changed = [];

  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    meta = { uuid: crypto.randomUUID() };
  }
  if (!/^[0-9a-f-]{36}$/i.test(meta.uuid || '')) {
    throw new Error(`invalid gltf uuid in ${metaPath}`);
  }

  const uuid = meta.uuid;
  const dir = path.join(libraryRoot, uuid.slice(0, 2));
  fs.mkdirSync(dir, { recursive: true });

  meta.ver ||= '2.3.14';
  meta.importer = 'gltf';
  meta.imported = true;
  meta.files = [];
  meta.subMetas ||= {};
  meta.userData ||= {};

  const meshes = doc.json.meshes || [];
  const materials = doc.json.materials || [];
  const textures = doc.json.textures || [];
  const images = doc.json.images || [];
  const samplers = doc.json.samplers || [];

  const meshIds = [];
  const textureIds = [];
  const materialIds = [];
  const sceneIds = [];
  const imageMetas = [];

  // --- textures / images ---
  const imageUuidByIndex = new Map();
  for (let i = 0; i < images.length; i++) {
    const imgPath = writeEmbeddedImage(assetPath, doc, i, changed);
    const imageUuid = ensureImageAsset(imgPath, libraryRoot, changed);
    imageUuidByIndex.set(i, imageUuid);
    const img = images[i];
    imageMetas.push({
      name: img.name || path.basename(imgPath, path.extname(imgPath)),
      uri: (img.uri && !img.uri.startsWith('data:')) ? img.uri : path.basename(imgPath),
    });
  }
  // Keep Creator's db:// imageMetas when already present and same length.
  if (!(Array.isArray(meta.userData.imageMetas) && meta.userData.imageMetas.length === images.length)) {
    meta.userData.imageMetas = imageMetas;
  }

  for (let i = 0; i < textures.length; i++) {
    const tex = textures[i];
    const src = tex.source != null ? tex.source : 0;
    const imageUuid = imageUuidByIndex.get(src);
    if (!imageUuid) continue;
    const name = `${tex.name || images[src]?.name || `tex_${i}`}.texture`;
    let id = findExistingSubId(meta, 'texture', i, name) || shortId('texture', i, name);
    const subUuid = `${uuid}@${id}`;
    const sampler = samplers[tex.sampler || 0] || {};
    meta.subMetas[id] = {
      importer: 'texture',
      uuid: subUuid,
      displayName: '',
      id,
      name,
      userData: {
        gltfIndex: i,
        wrapModeS: sampler.wrapS === 33071 ? 'clamp-to-edge' : 'repeat',
        wrapModeT: sampler.wrapT === 33071 ? 'clamp-to-edge' : 'repeat',
        minfilter: 'nearest',
        magfilter: 'nearest',
        mipfilter: 'nearest',
        anisotropy: 0,
        isUuid: false,
        imageUuidOrDatabaseUri: imageUuid,
      },
      ver: '1.0.22',
      imported: true,
      files: ['.json'],
      subMetas: {},
    };
    if (writeJsonIfChanged(
      path.join(dir, `${subUuid}.json`),
      textureJson(imageUuid, sampler.wrapS, sampler.wrapT),
    )) changed.push(`${subUuid}.json`);
    textureIds.push(subUuid);
  }

  // --- materials ---
  const vertexColorMats = new Set();
  for (const mesh of meshes) {
    for (const p of mesh.primitives || []) {
      if (p.attributes && p.attributes.COLOR_0 != null) {
        vertexColorMats.add(p.material != null ? p.material : 0);
      }
    }
  }
  for (let i = 0; i < Math.max(materials.length, 1); i++) {
    const mat = materials[i] || { name: 'Material' };
    const name = `${mat.name || `material_${i}`}.material`;
    let id = findExistingSubId(meta, 'gltf-material', i, name) || shortId('material', i, name);
    const subUuid = `${uuid}@${id}`;
    meta.subMetas[id] = {
      importer: 'gltf-material',
      uuid: subUuid,
      displayName: '',
      id,
      name,
      userData: { gltfIndex: i },
      ver: '1.0.14',
      imported: true,
      files: ['.json'],
      subMetas: {},
    };
    if (writeJsonIfChanged(
      path.join(dir, `${subUuid}.json`),
      materialJson(mat, textureIds, { useVertexColor: vertexColorMats.has(i) }),
    )) {
      changed.push(`${subUuid}.json`);
    }
    materialIds.push(subUuid);
  }

  // meshIndex → skinIndex (first node that binds both)
  const meshToSkin = new Map();
  for (const n of doc.json.nodes || []) {
    if (n.mesh != null && n.skin != null && !meshToSkin.has(n.mesh)) {
      meshToSkin.set(n.mesh, n.skin);
    }
  }

  // --- skeletons ---
  const skeletonIds = [];
  const skins = doc.json.skins || [];
  for (let i = 0; i < skins.length; i++) {
    const skelJson = buildSkeletonJson(doc, i);
    const name = `${skins[i].name || `UnnamedSkeleton-${i}`}.skeleton`;
    let id = findExistingSubId(meta, 'gltf-skeleton', i, name) || shortId('skel', i, name);
    const subUuid = `${uuid}@${id}`;
    meta.subMetas[id] = {
      importer: 'gltf-skeleton',
      uuid: subUuid,
      displayName: '',
      id,
      name,
      userData: { gltfIndex: i, jointsLength: skelJson._joints.length },
      ver: '1.0.14',
      imported: true,
      files: ['.json'],
      subMetas: {},
    };
    if (writeJsonIfChanged(path.join(dir, `${subUuid}.json`), skelJson)) {
      changed.push(`${subUuid}.json`);
    }
    skeletonIds.push(subUuid);
  }

  // --- meshes (all primitives per mesh) ---
  const meshMaterialSlots = []; // meshIndex → [materialIndex per prim]
  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i];
    if (!(mesh.primitives || []).length) {
      meshIds.push(null);
      meshMaterialSlots.push([]);
      continue;
    }
    const skinIndex = meshToSkin.has(i) ? meshToSkin.get(i) : null;
    const skin = skinIndex != null ? skins[skinIndex] : null;
    const built = buildMeshFromGltfMesh(doc, mesh, skin);
    const name = `${mesh.name || baseName}.mesh`;
    let id = findExistingSubId(meta, 'gltf-mesh', i, name) || shortId('mesh', i, name);
    const subUuid = `${uuid}@${id}`;
    meta.subMetas[id] = {
      importer: 'gltf-mesh',
      uuid: subUuid,
      displayName: '',
      id,
      name,
      userData: { gltfIndex: i, triangleCount: built.triangleCount },
      ver: '1.1.1',
      imported: true,
      files: ['.bin', '.json'],
      subMetas: {},
    };
    if (writeJsonIfChanged(path.join(dir, `${subUuid}.json`), built.meshJson)) changed.push(`${subUuid}.json`);
    if (writeBytesIfChanged(path.join(dir, `${subUuid}.bin`), built.bin)) changed.push(`${subUuid}.bin`);
    meshIds.push(subUuid);
    meshMaterialSlots.push(built.materialIndices);
  }

  // --- animations (ExoticAnimation CCON) ---
  const animationIds = [];
  const animList = doc.json.animations || [];
  const sample = 30;
  const animSettings = [];
  for (let i = 0; i < animList.length; i++) {
    const built = buildAnimationClipCcon(doc, i, sample);
    const name = `${built.name}.animation`;
    let id = findExistingSubId(meta, 'gltf-animation', i, name) || shortId('anim', i, name);
    const subUuid = `${uuid}@${id}`;
    meta.subMetas[id] = {
      importer: 'gltf-animation',
      uuid: subUuid,
      displayName: '',
      id,
      name,
      userData: {
        gltfIndex: i,
        wrapMode: 2,
        sample,
        span: { from: 0, to: built.duration },
        events: [],
      },
      ver: '1.0.18',
      imported: true,
      files: ['.bin'],
      subMetas: {},
    };
    if (writeBytesIfChanged(path.join(dir, `${subUuid}.bin`), built.bin)) {
      changed.push(`${subUuid}.bin`);
    }
    animationIds.push(subUuid);
    animSettings.push({
      name: built.name,
      duration: built.duration,
      fps: sample,
      splits: [{
        name: built.name,
        from: 0,
        to: built.duration,
        wrapMode: 2,
        previousId: id,
      }],
    });
  }
  if (animSettings.length) meta.userData.animationImportSettings = animSettings;

  // --- scene prefab (full glTF node hierarchy) ---
  if (meshIds.some(Boolean) || (doc.json.nodes || []).length) {
    const name = `${baseName}.prefab`;
    let id = findExistingSubId(meta, 'gltf-scene', 0, name) || shortId('scene', 0, name);
    const subUuid = `${uuid}@${id}`;
    meta.subMetas[id] = {
      importer: 'gltf-scene',
      uuid: subUuid,
      displayName: '',
      id,
      name,
      userData: { gltfIndex: 0 },
      ver: '1.0.14',
      imported: true,
      files: ['.json'],
      subMetas: {},
    };
    const prefab = buildHierarchyPrefab(
      doc,
      meshIds,
      materialIds,
      meshMaterialSlots,
      subUuid,
      baseName,
      animationIds,
      skeletonIds,
    );
    if (writeJsonIfChanged(path.join(dir, `${subUuid}.json`), prefab)) changed.push(`${subUuid}.json`);
    sceneIds.push(subUuid);
  }

  meta.userData.assetFinder = {
    meshes: meshIds.filter(Boolean),
    skeletons: skeletonIds.filter(Boolean),
    textures: textureIds,
    materials: materialIds,
    scenes: sceneIds,
  };
  meta.userData.lods ||= {
    enable: false,
    hasBuiltinLOD: false,
    options: [
      { screenRatio: 0.25, faceCount: 1 },
      { screenRatio: 0.125, faceCount: 0.25 },
      { screenRatio: 0.01, faceCount: 0.1 },
    ],
  };
  meta.userData.imageFindOrder ||= [];

  if (writeJsonIfChanged(metaPath, meta)) changed.push(metaPath);

  return {
    assetPath,
    uuid,
    meshes: meshIds,
    materials: materialIds,
    textures: textureIds,
    scenes: sceneIds,
    animations: animationIds,
    skeletons: skeletonIds,
    changed,
  };
}

module.exports = {
  GLTF_EXTS,
  STANDARD_EFFECT,
  CAR_PAINT_EFFECT,
  UNLIT_EFFECT,
  prepareMeshopt,
  prepareDraco,
  prepareGltfDecoders,
  importGltf,
  importGltfAsync,
  loadGltf,
  parseGlb,
};
