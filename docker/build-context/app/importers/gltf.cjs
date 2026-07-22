#!/usr/bin/env node
'use strict';

/**
 * Minimal Cocos Creator 3.8 glTF / GLB importer for headless preview.
 *
 * Scope: meshes (POSITION / NORMAL / TEXCOORD_0 [/ TANGENT]), material + albedo,
 * full node hierarchy prefab, and node-TRS animations as ExoticAnimation CCON
 * (`gltf-animation`). No skins / morphs / lights.
 *
 * Library products (mirrors Creator's `gltf` importer shape):
 *   <uuid>@xxxxx.json/.bin   cc.Mesh
 *   <uuid>@xxxxx.json        cc.Texture2D  (mipmaps → ImageAsset uuid)
 *   <uuid>@xxxxx.json        cc.Material   (builtin standard effect)
 *   <uuid>@xxxxx.bin         cc.AnimationClip (CCON v2 ExoticAnimation)
 *   <uuid>@xxxxx.json        prefab array  (gltf-scene + cc.Animation)
 *
 * Sub-meta ids are preserved when present in .meta; otherwise derived as
 * md5(`${kind}:${index}:${name}`).slice(0,5) so reimports stay stable.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { importImage } = require('./image.cjs');
const { encodeCCONBinary } = require('./ccon.cjs');

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

  const stride = 48;
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
  };
}

/** Build one cc.Mesh from a glTF mesh (all primitives). */
function buildMeshFromGltfMesh(doc, gltfMesh) {
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

  for (let i = 0; i < built.length; i++) {
    const b = built[i];
    const vbOffset = offset;
    parts.push(b.vb);
    offset += b.vb.length;
    const ibOffset = offset;
    parts.push(b.ib);
    offset += b.ib.length;

    vertexBundles.push({
      view: { offset: vbOffset, length: b.vb.length, count: b.nVert, stride: 48 },
      attributes: [
        { name: 'a_position', format: FMT.RGB32F, isNormalized: false },
        { name: 'a_normal', format: FMT.RGB32F, isNormalized: false },
        { name: 'a_texCoord', format: FMT.RG32F, isNormalized: false },
        { name: 'a_tangent', format: FMT.RGBA32F, isNormalized: false },
      ],
    });
    primitives.push({
      primitiveMode: PRIM_TRIANGLES,
      vertexBundelIndices: [i],
      indexView: {
        offset: ibOffset,
        length: b.ib.length,
        count: b.indexCount,
        stride: b.indexStride,
      },
    });
    triangleCount += Math.floor(b.indexCount / 3);
    if (b.min[0] < minX) minX = b.min[0];
    if (b.min[1] < minY) minY = b.min[1];
    if (b.min[2] < minZ) minZ = b.min[2];
    if (b.max[0] > maxX) maxX = b.max[0];
    if (b.max[1] > maxY) maxY = b.max[1];
    if (b.max[2] > maxZ) maxZ = b.max[2];
  }

  const bin = Buffer.concat(parts);
  const meshJson = {
    __type__: 'cc.Mesh',
    _name: '',
    _objFlags: 0,
    __editorExtras__: {},
    _native: '.bin',
    _struct: {
      primitives,
      vertexBundles,
      minPosition: { __type__: 'cc.Vec3', x: minX, y: minY, z: minZ },
      maxPosition: { __type__: 'cc.Vec3', x: maxX, y: maxY, z: maxZ },
    },
    _hash: djb2(bin),
    _allowDataAccess: true,
  };
  // Material slots follow primitive order (Creator assigns one material per prim).
  const materialIndices = built.map((b) => b.materialIndex);
  return { bin, meshJson, materialIndices, triangleCount };
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
  for (const ch of anim.channels || []) {
    if (ch.target == null || ch.target.node == null) continue;
    const pathName = ch.target.path;
    if (pathName !== 'translation' && pathName !== 'rotation' && pathName !== 'scale') continue;
    const sampler = (anim.samplers || [])[ch.sampler];
    if (!sampler) continue;
    const times = readAccessor(doc, sampler.input).values;
    const values = readAccessor(doc, sampler.output).values;
    if (times.length) duration = Math.max(duration, times[times.length - 1]);
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
    _tracks: [],
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
 *   Prefab → outer wrapper node → glTF scene root(s) with full TRS hierarchy
 *   and MeshRenderer on every node that references a mesh.
 *   Optional clipUuids → cc.Animation on the wrapper.
 */
function buildHierarchyPrefab(doc, meshIds, materialIds, meshMaterialSlots, seed, fallbackName, clipUuids) {
  const nodes = doc.json.nodes || [];
  const scenes = doc.json.scenes || [];
  const scene = scenes[doc.json.scene || 0] || scenes[0] || { nodes: nodes.length ? [0] : [], name: fallbackName };
  const sceneName = scene.name || fallbackName || 'Root';
  const rootIndices = scene.nodes && scene.nodes.length ? scene.nodes : (nodes.length ? [0] : []);

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
      out.push(makeMeshRenderer(objId, meshUuid, mats, bakeId, compInfoId));
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

  if (clipUuids && clipUuids.length) {
    const animId = out.length;
    const compInfoId = animId + 1;
    out[wrapperId]._components.push({ __id__: animId });
    const defaultUuid = clipUuids[0];
    out.push({
      __type__: 'cc.Animation',
      _name: '',
      _objFlags: 0,
      __editorExtras__: {},
      node: { __id__: wrapperId },
      _enabled: true,
      __prefab: { __id__: compInfoId },
      playOnLoad: false,
      _clips: clipUuids.map((u) => ({
        __uuid__: u,
        __expectedType__: 'cc.AnimationClip',
      })),
      _defaultClip: defaultUuid
        ? { __uuid__: defaultUuid, __expectedType__: 'cc.AnimationClip' }
        : null,
      _id: '',
    });
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

  // --- meshes (all primitives per mesh) ---
  const meshMaterialSlots = []; // meshIndex → [materialIndex per prim]
  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i];
    if (!(mesh.primitives || []).length) {
      meshIds.push(null);
      meshMaterialSlots.push([]);
      continue;
    }
    const built = buildMeshFromGltfMesh(doc, mesh);
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
    );
    if (writeJsonIfChanged(path.join(dir, `${subUuid}.json`), prefab)) changed.push(`${subUuid}.json`);
    sceneIds.push(subUuid);
  }

  meta.userData.assetFinder = {
    meshes: meshIds.filter(Boolean),
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
    animations: animationIds,
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
