#!/usr/bin/env node
'use strict';

/**
 * Minimal Cocos Creator 3.8 glTF / GLB importer for headless preview.
 *
 * Scope (MVP): static meshes with POSITION / NORMAL / TEXCOORD_0 [/ TANGENT],
 * one material + albedo texture (external URI or embedded image), and a
 * MeshRenderer prefab for scene 0. No skins, morphs, animations, or lights.
 *
 * Library products (mirrors Creator's `gltf` importer shape):
 *   <uuid>@xxxxx.json/.bin   cc.Mesh
 *   <uuid>@xxxxx.json        cc.Texture2D  (mipmaps → ImageAsset uuid)
 *   <uuid>@xxxxx.json        cc.Material   (builtin standard effect)
 *   <uuid>@xxxxx.json        prefab array  (gltf-scene)
 *
 * Sub-meta ids are preserved when present in .meta; otherwise derived as
 * md5(`${kind}:${index}:${name}`).slice(0,5) so reimports stay stable.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { importImage } = require('./image.cjs');

const GLTF_EXTS = new Set(['.gltf', '.glb']);
const STANDARD_EFFECT = 'c8f66d17-351a-48da-a12c-0212d28575c4';

// Cocos GFX Format enum values used in Mesh._struct
const FMT = { RG32F: 21, RGB32F: 32, RGBA32F: 44 };
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
  return { json, bin };
}

function loadGltf(assetPath) {
  const ext = path.extname(assetPath).toLowerCase();
  if (ext === '.glb') return parseGlb(fs.readFileSync(assetPath));
  const json = JSON.parse(fs.readFileSync(assetPath, 'utf8'));
  let bin = Buffer.alloc(0);
  const buf0 = json.buffers && json.buffers[0];
  if (buf0 && buf0.uri) {
    if (buf0.uri.startsWith('data:')) {
      const m = buf0.uri.match(/^data:[^;]+;base64,(.+)$/);
      if (!m) throw new Error('unsupported data URI buffer');
      bin = Buffer.from(m[1], 'base64');
    } else {
      bin = fs.readFileSync(path.join(path.dirname(assetPath), buf0.uri));
    }
  }
  return { json, bin };
}

function accessorInfo(doc, accessorIndex) {
  const acc = doc.json.accessors[accessorIndex];
  if (!acc) throw new Error(`missing accessor ${accessorIndex}`);
  const count = TYPE_COUNT[acc.type];
  if (!count) throw new Error(`unsupported accessor type ${acc.type}`);
  const comp = COMPONENT[acc.componentType];
  if (!comp) throw new Error(`unsupported componentType ${acc.componentType}`);
  const view = doc.json.bufferViews[acc.bufferView];
  if (!view) throw new Error(`missing bufferView ${acc.bufferView}`);
  if ((view.buffer || 0) !== 0) throw new Error('only buffer 0 supported');
  const base = (view.byteOffset || 0) + (acc.byteOffset || 0);
  const stride = view.byteStride || comp.size * count;
  return { acc, count, comp, base, stride, view };
}

function readAccessor(doc, accessorIndex) {
  const { acc, count, comp, base, stride } = accessorInfo(doc, accessorIndex);
  const out = new Float32Array(acc.count * count);
  for (let i = 0; i < acc.count; i++) {
    const row = base + i * stride;
    for (let c = 0; c < count; c++) {
      out[i * count + c] = comp.read(doc.bin, row + c * comp.size);
    }
  }
  return { values: out, count: acc.count, components: count, min: acc.min, max: acc.max };
}

function readIndices(doc, accessorIndex) {
  const { acc, count, comp, base, stride } = accessorInfo(doc, accessorIndex);
  if (count !== 1) throw new Error('indices must be SCALAR');
  const out = new Uint32Array(acc.count);
  for (let i = 0; i < acc.count; i++) {
    out[i] = comp.read(doc.bin, base + i * stride);
  }
  return out;
}

function buildInterleavedMesh(doc, primitive) {
  const attrs = primitive.attributes || {};
  if (attrs.POSITION == null) throw new Error('primitive missing POSITION');
  const pos = readAccessor(doc, attrs.POSITION);
  const nVert = pos.count;
  const nor = attrs.NORMAL != null
    ? readAccessor(doc, attrs.NORMAL)
    : { values: new Float32Array(nVert * 3), components: 3 };
  const uv = attrs.TEXCOORD_0 != null
    ? readAccessor(doc, attrs.TEXCOORD_0)
    : { values: new Float32Array(nVert * 2), components: 2 };
  let tan;
  if (attrs.TANGENT != null) {
    tan = readAccessor(doc, attrs.TANGENT);
  } else {
    // Placeholder tangents (1,0,0,1) — enough for albedo-only materials.
    const v = new Float32Array(nVert * 4);
    for (let i = 0; i < nVert; i++) {
      v[i * 4] = 1;
      v[i * 4 + 3] = 1;
    }
    tan = { values: v, components: 4 };
  }

  const stride = 48; // 12+12+8+16
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
    vb.writeFloatLE(tan.values[i * 4] || 1, o + 32);
    vb.writeFloatLE(tan.values[i * 4 + 1] || 0, o + 36);
    vb.writeFloatLE(tan.values[i * 4 + 2] || 0, o + 40);
    vb.writeFloatLE(tan.values[i * 4 + 3] || 1, o + 44);
    if (px < minX) minX = px; if (py < minY) minY = py; if (pz < minZ) minZ = pz;
    if (px > maxX) maxX = px; if (py > maxY) maxY = py; if (pz > maxZ) maxZ = pz;
  }

  let indices;
  if (primitive.indices != null) {
    indices = readIndices(doc, primitive.indices);
  } else {
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

  const bin = Buffer.concat([vb, ib]);
  const meshJson = {
    __type__: 'cc.Mesh',
    _name: '',
    _objFlags: 0,
    __editorExtras__: {},
    _native: '.bin',
    _struct: {
      primitives: [{
        primitiveMode: PRIM_TRIANGLES,
        vertexBundelIndices: [0],
        indexView: {
          offset: vb.length,
          length: ib.length,
          count: indices.length,
          stride: use32 ? 4 : 2,
        },
      }],
      vertexBundles: [{
        view: {
          offset: 0,
          length: vb.length,
          count: nVert,
          stride,
        },
        attributes: [
          { name: 'a_position', format: FMT.RGB32F, isNormalized: false },
          { name: 'a_normal', format: FMT.RGB32F, isNormalized: false },
          { name: 'a_texCoord', format: FMT.RG32F, isNormalized: false },
          { name: 'a_tangent', format: FMT.RGBA32F, isNormalized: false },
        ],
      }],
      minPosition: { __type__: 'cc.Vec3', x: minX, y: minY, z: minZ },
      maxPosition: { __type__: 'cc.Vec3', x: maxX, y: maxY, z: maxZ },
    },
    _hash: djb2(bin),
    _allowDataAccess: true,
  };
  return {
    bin,
    meshJson,
    materialIndex: primitive.material != null ? primitive.material : 0,
    triangleCount: Math.floor(indices.length / 3),
  };
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
    bytes = doc.bin.slice(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
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

function materialJson(name, textureUuid) {
  const props = {
    tilingOffset: { __type__: 'cc.Vec4', x: 1, y: 1, z: 0, w: 0 },
    metallic: 0,
    occlusion: 0,
  };
  const defines = [{}];
  if (textureUuid) {
    props.mainTexture = {
      __uuid__: textureUuid,
      __expectedType__: 'cc.Texture2D',
    };
    defines[0].USE_ALBEDO_MAP = true;
  }
  return {
    __type__: 'cc.Material',
    _name: name || '',
    _objFlags: 0,
    __editorExtras__: {},
    _native: '',
    _effectAsset: {
      __uuid__: STANDARD_EFFECT,
      __expectedType__: 'cc.EffectAsset',
    },
    _techIdx: 0,
    _defines: defines,
    _states: [{
      rasterizerState: { cullMode: 0 },
      blendState: { targets: [{}] },
      depthStencilState: {},
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

function prefabJson(rootName, meshUuid, materialUuid, seed) {
  return [
    {
      __type__: 'cc.Prefab',
      _name: '',
      _objFlags: 0,
      __editorExtras__: {},
      _native: '',
      data: { __id__: 1 },
      optimizationPolicy: 0,
      persistent: false,
    },
    {
      __type__: 'cc.Node',
      _name: rootName,
      _objFlags: 0,
      __editorExtras__: {},
      _parent: null,
      _children: [{ __id__: 2 }],
      _active: true,
      _components: [],
      _prefab: { __id__: 7 },
      _lpos: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
      _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 },
      _lscale: { __type__: 'cc.Vec3', x: 1, y: 1, z: 1 },
      _mobility: 0,
      _layer: 1073741824,
      _euler: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
      _id: '',
    },
    {
      __type__: 'cc.Node',
      _name: rootName,
      _objFlags: 0,
      __editorExtras__: {},
      _parent: { __id__: 1 },
      _children: [],
      _active: true,
      _components: [{ __id__: 3 }],
      _prefab: { __id__: 6 },
      _lpos: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
      _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 },
      _lscale: { __type__: 'cc.Vec3', x: 1, y: 1, z: 1 },
      _mobility: 0,
      _layer: 1073741824,
      _euler: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
      _id: '',
    },
    {
      __type__: 'cc.MeshRenderer',
      _name: '',
      _objFlags: 0,
      __editorExtras__: {},
      node: { __id__: 2 },
      _enabled: true,
      __prefab: { __id__: 4 },
      _materials: materialUuid ? [{
        __uuid__: materialUuid,
        __expectedType__: 'cc.Material',
      }] : [],
      _visFlags: 0,
      bakeSettings: { __id__: 5 },
      _mesh: {
        __uuid__: meshUuid,
        __expectedType__: 'cc.Mesh',
      },
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
    },
    { __type__: 'cc.CompPrefabInfo', fileId: fileIdFrom(`${seed}:comp`) },
    {
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
    },
    {
      __type__: 'cc.PrefabInfo',
      root: { __id__: 1 },
      asset: { __id__: 0 },
      fileId: fileIdFrom(`${seed}:child`),
      instance: null,
      targetOverrides: null,
      nestedPrefabInstanceRoots: null,
    },
    {
      __type__: 'cc.PrefabInfo',
      root: { __id__: 1 },
      asset: { __id__: 0 },
      fileId: fileIdFrom(`${seed}:root`),
      instance: null,
      targetOverrides: null,
      nestedPrefabInstanceRoots: null,
    },
  ];
}

function findExistingSubId(meta, importer, gltfIndex, nameHint) {
  const subs = meta.subMetas || {};
  for (const [id, sub] of Object.entries(subs)) {
    if (sub.importer !== importer) continue;
    if (sub.userData && sub.userData.gltfIndex === gltfIndex) return id;
    if (nameHint && (sub.name === nameHint || (sub.name || '').startsWith(nameHint))) return id;
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
    let id = findExistingSubId(meta, 'texture', i, name)
      || findExistingSubId(meta, 'texture', undefined, name)
      || shortId('texture', i, name);
    const subUuid = `${uuid}@${id}`;
    const sampler = samplers[tex.sampler || 0] || {};
    meta.subMetas[id] = {
      importer: 'texture',
      uuid: subUuid,
      displayName: '',
      id,
      name,
      userData: {
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
  for (let i = 0; i < Math.max(materials.length, 1); i++) {
    const mat = materials[i] || { name: 'Material' };
    const name = `${mat.name || `material_${i}`}.material`;
    let id = findExistingSubId(meta, 'gltf-material', i, name) || shortId('material', i, name);
    const subUuid = `${uuid}@${id}`;
    let texSub = null;
    const baseColorTex = mat.pbrMetallicRoughness
      && mat.pbrMetallicRoughness.baseColorTexture
      && mat.pbrMetallicRoughness.baseColorTexture.index;
    if (baseColorTex != null && textureIds[baseColorTex]) texSub = textureIds[baseColorTex];
    else if (textureIds[0]) texSub = textureIds[0];
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
    if (writeJsonIfChanged(path.join(dir, `${subUuid}.json`), materialJson(mat.name || name, texSub))) {
      changed.push(`${subUuid}.json`);
    }
    materialIds.push(subUuid);
  }

  // --- meshes (first primitive of each mesh for MVP) ---
  const meshMatPairs = [];
  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i];
    const prim = (mesh.primitives || [])[0];
    if (!prim) continue;
    const built = buildInterleavedMesh(doc, prim);
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
    meshMatPairs.push({
      meshUuid: subUuid,
      materialUuid: materialIds[built.materialIndex] || materialIds[0] || null,
      name: mesh.name || baseName,
    });
  }

  // --- scene prefab (scene 0 / first mesh) ---
  const pair = meshMatPairs[0];
  if (pair) {
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
    const prefab = prefabJson(pair.name, pair.meshUuid, pair.materialUuid, subUuid);
    if (writeJsonIfChanged(path.join(dir, `${subUuid}.json`), prefab)) changed.push(`${subUuid}.json`);
    sceneIds.push(subUuid);
  }

  meta.userData.assetFinder = {
    meshes: meshIds,
    skeletons: [],
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
    changed,
  };
}

module.exports = {
  GLTF_EXTS,
  STANDARD_EFFECT,
  importGltf,
  loadGltf,
  parseGlb,
};
