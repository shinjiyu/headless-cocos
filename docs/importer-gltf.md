# glTF / GLB / FBX importer

Headless importer for Cocos Creator 3.8 mesh assets.

## Scope

| Supported | Not yet / out of scope |
|-----------|------------------------|
| `.gltf` + external `.bin` / images | Cameras / lights (**Creator also skips** — not planned) |
| `.glb` (JSON + BIN chunks) | **KHR_materials_transmission** (no builtin effect) |
| `.fbx` via Creator `FBX2glTF` → glTF | |
| POSITION / NORMAL / TEXCOORD_0 [/ **TEXCOORD_1**] / TANGENT | |
| **COLOR_0** (+ `USE_VERTEX_COLOR`) | |
| `texCoord=1` → `HAS_SECOND_UV` / `*_UV: v_uv1` | |
| **KHR_texture_transform** → `tilingOffset` | |
| **KHR_materials_clearcoat** → `car-paint` effect | |
| **JOINTS_0 / WEIGHTS_0** + `gltf-skeleton` | |
| **Morph targets** (POSITION [/ NORMAL / TANGENT]) + weight tracks | |
| **All meshes + all primitives** | |
| **Full node hierarchy + TRS** → prefab | |
| **Animations** → ExoticAnimation CCON (`.bin`) | |
| Albedo + **normal / pbrMap (ORM) / occlusion / emissive** | |
| **alphaMode** MASK / BLEND (+ doubleSided) | |
| Preserve Creator `.meta` sub-ids | |
| **Poly Haven fetch** → `importGltf` (`docs/polyhaven.md`) | |
| Mirror **`/__polyhaven?spawn=1`** → instantiate prefab in preview | |

## Library products

Root meta: `importer: "gltf"` (or `"fbx"`), `files: []`.

| Sub | Importer | Files |
|-----|----------|-------|
| mesh (per glTF mesh) | `gltf-mesh` | `.json` + `.bin` (multi-primitive; optional color/uv1; skinned stride 72+; morph deltas) |
| texture | `texture` | `.json` |
| material | `gltf-material` | `.json` (builtin-standard or **car-paint** for clearcoat; UV sets; texture_transform; MASK/BLEND) |
| skeleton (per skin) | `gltf-skeleton` | `.json` (`_joints` paths + `_bindposes`) |
| animation (per clip) | `gltf-animation` | `.bin` only (CCON v2 ExoticAnimation) |
| scene | `gltf-scene` | hierarchy prefab + `Animation` / `SkeletalAnimation` |

Standard effect: `c8f66d17-351a-48da-a12c-0212d28575c4`.

## FBX

`importers/fbx.cjs` shells out to:

`{CREATOR}/resources/app.asar.unpacked/node_modules/@cocos/fbx2gltf/bin/Windows_NT/FBX2glTF.exe`

Override with `FBX2GLTF`. Intermediate `.glb` is written under `os.tmpdir()/fbx2gltf-<hash>/` (mtime-cached).

## Code

- `spike/importers/gltf.cjs` — hierarchy + multi-prim + animations + skins + morphs
- `spike/importers/ccon.cjs` — CCON v2 encode/decode (vendored notepack)
- `spike/importers/fbx.cjs` — FBX → glTF → importGltf
- Mirror: `PACKER=mini` boot + watcher
- E2E: `e2e-gltf.cjs`, `e2e-gltf-hierarchy.cjs`, `e2e-gltf-anim.cjs`, `e2e-gltf-skin.cjs`, `e2e-gltf-morph.cjs`, `e2e-gltf-pbr.cjs`, `e2e-gltf-alpha.cjs`, `e2e-gltf-color-uv1.cjs`, `e2e-gltf-uv1-transform.cjs`, `e2e-gltf-clearcoat.cjs`, `e2e-polyhaven.cjs`, `e2e-fbx.cjs`
- Online assets: [`docs/polyhaven.md`](polyhaven.md)

## Verify

```powershell
node .\spike\e2e-gltf.cjs
node .\spike\e2e-gltf-hierarchy.cjs
node .\spike\e2e-gltf-anim.cjs --disk-only
node .\spike\e2e-gltf-skin.cjs
node .\spike\e2e-gltf-skin.cjs --fbx
node .\spike\e2e-gltf-morph.cjs
node .\spike\e2e-gltf-pbr.cjs
node .\spike\e2e-gltf-alpha.cjs
node .\spike\e2e-gltf-color-uv1.cjs
node .\spike\e2e-gltf-uv1-transform.cjs
node .\spike\e2e-gltf-clearcoat.cjs
node .\spike\e2e-polyhaven.cjs
node .\spike\e2e-fbx.cjs
```

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
- Optional coat textures → `coatDataMap` (Creator channel pack differs from glTF)
