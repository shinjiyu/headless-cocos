# glTF / GLB / FBX importer

Headless importer for Cocos Creator 3.8 mesh assets.

**Status:** Creator-aligned glTF 2.0 path is feature-complete for builtin /
advanced effects that ship with 3.8. Remaining gaps are things Creator itself
skips, or extensions with no matching effect.

## Scope

### Supported

| Area | Notes |
|------|--------|
| `.gltf` / `.glb` / multi-buffer bins | Flattened to buffer 0 before reads |
| `.fbx` | Via Creator `FBX2glTF` → glTF |
| Mesh attrs | POSITION, NORMAL, TEXCOORD_0/1, TANGENT, COLOR_0, sparse accessors |
| Skin | JOINTS_n / WEIGHTS_n → Creator top-4 → `a_joints` / `a_weights` + skeleton |
| Morph | POSITION [/ NORMAL / TANGENT] + weight tracks |
| Hierarchy / anim | Full node TRS prefab; ExoticAnimation CCON |
| Compression | `EXT_/KHR_meshopt_compression`, `KHR_draco_mesh_compression` |
| PBR maps | Albedo, normal, ORM/pbrMap, occlusion, emissive; alpha MASK/BLEND; doubleSided |
| UV / transform | `texCoord=1`, `KHR_texture_transform` → tilingOffset |
| Materials | unlit; clearcoat→car-paint; sheen→fabric; transmission→glass (approx); ior/specular; emissive_strength; anisotropy |
| Variants | `KHR_materials_variants` baked via `options.variant` / mirror `?variant=` |
| Online / mirror | Poly Haven fetch; `/__polyhaven`, `/__gltf` |

### Intentionally skipped / approximate

| Item | Why |
|------|-----|
| Cameras / lights | Creator glTF importer also skips — not planned |
| `KHR_materials_iridescence` | No matching builtin/advanced effect in 3.8 |
| Transmission / volume | Mapped to **stylized** `glass` (not path-traced refraction) |
| `KHR_texture_basisu` / WebP GPU decode | Out of scope; use pre-decoded images |
| Runtime material variant switcher | Creator has none; bake at import only |

## Library products

Root meta: `importer: "gltf"` (or `"fbx"`), `files: []`.

| Sub | Importer | Files |
|-----|----------|-------|
| mesh (per glTF mesh) | `gltf-mesh` | `.json` + `.bin` (multi-primitive; optional color/uv1; skinned stride 72+; morph deltas) |
| texture | `texture` | `.json` |
| material | `gltf-material` | `.json` (standard / **unlit** / **car-paint** / **fabric** / **glass**; UV sets; texture_transform; MASK/BLEND) |
| skeleton (per skin) | `gltf-skeleton` | `.json` (`_joints` paths + `_bindposes`) |
| animation (per clip) | `gltf-animation` | `.bin` only (CCON v2 ExoticAnimation) |
| scene | `gltf-scene` | hierarchy prefab + `Animation` / `SkeletalAnimation` |

Standard effect: `c8f66d17-351a-48da-a12c-0212d28575c4`.

## FBX

`importers/fbx.cjs` shells out to:

`{CREATOR}/resources/app.asar.unpacked/node_modules/@cocos/fbx2gltf/bin/Windows_NT/FBX2glTF.exe`

Override with `FBX2GLTF`. Intermediate `.glb` is written under `os.tmpdir()/fbx2gltf-<hash>/` (mtime-cached).

## Code

- `spike/importers/gltf.cjs` — hierarchy + multi-prim + animations + skins + morphs + materials
- `spike/importers/ccon.cjs` — CCON v2 encode/decode (vendored notepack)
- `spike/importers/fbx.cjs` — FBX → glTF → importGltf
- Mirror: `PACKER=mini` boot + watcher + `/__gltf` / `/__polyhaven`
- Smoke: `spike/e2e-gltf-all.cjs` (local fixtures); `--extra` for morph/anim/skin/network/fbx
- Online assets: [`docs/polyhaven.md`](polyhaven.md)

## Verify

```powershell
# Local fixture smoke (no browser / no network)
npm run test:gltf
# or: node .\spike\e2e-gltf-all.cjs

# Also try optional fixtures / network when available
node .\spike\e2e-gltf-all.cjs --extra
```

Individual suites still live under `spike/e2e-gltf-*.cjs` (see filenames). Browser-backed
checks: `e2e-gltf.cjs`, `e2e-gltf-hierarchy.cjs` (need preview-mirror).

Meshopt / Draco: `npm i meshoptimizer draco3dgltf`, then `await prepareMeshopt()` / `prepareDraco()` (or `importGltfAsync` / `prepareGltfDecoders`) before importing compressed assets. Mirror boots both automatically.

Ground truth (`character-a.glb` from selfGame / Kenney):

- 6 meshes, sub-ids preserved (`@00956` …)
- Prefab: 9 nodes, 6 `MeshRenderer`, head scale `(0.1,0.1,0.1)`
- 27 animation clips (idle `@1f586`), ExoticAnimation paths match Creator

Skinned ground truth (Creator `soldier.FBX` / perlab):

- 4 skeletons (`@30732` …), 4 skinned meshes (stride 72)
- Prefab: 4 `SkinnedMeshRenderer` + `SkeletalAnimation`

Morph ground truth (`spike/fixtures/gltf-morph-cube/AnimatedMorphCube.glb`):

- 2 morph targets with POSITION/NORMAL/TANGENT displacements
- Weight animation → `RealArrayTrack` + `MorphWeightsAllValueProxy`

PBR ground truth (Poly Haven `wooden_table_02` @1k):

- `USE_ALBEDO_MAP` + `USE_NORMAL_MAP` + `USE_PBR_MAP` (ARM → `pbrMap`)

Alpha (`fixtures/gltf-alpha/alpha-modes.gltf`):

- `BLEND` → `_techIdx: 1`, depthWrite off, SrcAlpha / OneMinusSrcAlpha
- `MASK` → `USE_ALPHA_TEST` + `alphaThreshold`
- `doubleSided` → cullMode `NONE` + `USE_TWOSIDE`

COLOR / UV1 (`fixtures/gltf-color-uv1/color-uv1.gltf`):

- `COLOR_0` (normalized u8) → `a_color` RGBA32F + material `USE_VERTEX_COLOR`
- `TEXCOORD_1` → `a_texCoord1`

UV set + transform (`fixtures/gltf-uv1-transform/uv1-transform.gltf`):

- `baseColorTexture.texCoord: 1` → `ALBEDO_UV: v_uv1` + `HAS_SECOND_UV`
- `KHR_texture_transform` scale/offset → `tilingOffset`

Clearcoat (`fixtures/gltf-clearcoat/clearcoat.gltf`):

- `KHR_materials_clearcoat` → effect `car-paint` (`304a12db-…`)
- `clearcoatFactor` → `coatIntensity`; `clearcoatRoughnessFactor` → `coatRoughness`

Sheen (`fixtures/gltf-sheen/sheen.gltf`):

- `KHR_materials_sheen` → effect `fabric` (`b25c7601-…`)
- `sheenColorFactor` → `sheenColor`; `sheenRoughnessFactor` → `sheenRoughness`
- Optional `sheenColorTexture` / `sheenRoughnessTexture` → `USE_SHEEN_COLOR_MAP` / `USE_SHEEN_DATA_MAP`
- Clearcoat wins if both extensions are present

Transmission (`fixtures/gltf-transmission/transmission.gltf`):

- `KHR_materials_transmission` → effect `glass` (`f288f946-…`, stylized — not path-traced)
- `KHR_materials_ior` → `F0` / `F90` (F0 ≈ F0(ior)/0.08)
- `KHR_materials_volume` attenuationColor / thicknessFactor → `gradientColor` / `gradientIntensity`
- `doubleSided` → glass technique 1 (two-sided)
- Priority: clearcoat > sheen > transmission

Variants (`fixtures/gltf-variants/variants.gltf`):

- Root `KHR_materials_variants` names → `meta.userData.materialVariants` + `result.variants`
- Primitive mappings baked into MeshRenderer slots via `importGltf(path, lib, { variant: 'Yellow' | 0 })`
- Default (no option) keeps `primitive.material`
- Mirror: `/__gltf?file=assets/foo.gltf&variant=Yellow&spawn=1` and `/__polyhaven?...&variant=`
- Optional coat textures → `coatDataMap` (Creator channel pack differs from glTF)

Unlit (`fixtures/gltf-unlit/unlit.gltf`):

- `KHR_materials_unlit` → effect `builtin-unlit` (`a3cd009f-…`)
- baseColor → `mainColor` / `USE_TEXTURE` (not PBR maps)

Emissive strength (`fixtures/gltf-emissive-strength/emissive-strength.gltf`):

- `KHR_materials_emissive_strength.emissiveStrength` → `emissiveScale` vec3

IOR / specular / anisotropy (`fixtures/gltf-ior-anisotropy/ior-anisotropy.gltf`):

- `ior` + `specularFactor` → `specularIntensity` (`F0(ior)/0.08 * specularFactor`)
- `anisotropyStrength` / `anisotropyRotation` → `IS_ANISOTROPY` + intensity / rotation÷π

Sparse (`fixtures/gltf-sparse/sparse.gltf`):

- Dense base + `accessor.sparse` overlay; also bufferView-less sparse-only accessors

Meshopt (`fixtures/gltf-meshopt/meshopt.gltf`):

- `EXT_meshopt_compression` on attribute + TRIANGLES index bufferViews
- Requires `meshoptimizer` + `prepareMeshopt()` / `importGltfAsync`

Draco (`fixtures/gltf-draco/draco.gltf`):

- `KHR_draco_mesh_compression` on the primitive (POSITION / NORMAL / TEXCOORD_0)
- Requires `draco3dgltf` + `prepareDraco()` / `importGltfAsync`
- Expanded after meshopt so a meshopt-wrapped Draco bitstream still works

Multi-buffer (`fixtures/gltf-multibuffer/multibuffer.gltf`):

- Positions in `pos.bin` (buffer 0); normals / UVs / indices in `rest.bin` (buffer 1)
- Flattened to a single buffer 0 before accessor / embedded-image reads

Joints1 (`fixtures/gltf-joints1/joints1.gltf`):

- `JOINTS_0`/`WEIGHTS_0` + `JOINTS_1`/`WEIGHTS_1` (8 influences)
- Creator-compatible prune: sort by weight, keep top 4 → `a_joints` / `a_weights` (no `a_joints1`)
