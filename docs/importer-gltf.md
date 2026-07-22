# glTF / GLB / FBX importer

Headless importer for Cocos Creator 3.8 mesh assets.

## Scope

| Supported | Not yet / out of scope |
|-----------|------------------------|
| `.gltf` + external `.bin` / images | Cameras / lights (**Creator also skips** — not planned) |
| `.glb` (JSON + BIN chunks) | |
| `.fbx` via Creator `FBX2glTF` → glTF | |
| POSITION / NORMAL / TEXCOORD_0 / TANGENT | |
| **JOINTS_0 / WEIGHTS_0** + `gltf-skeleton` | |
| **Morph targets** (POSITION [/ NORMAL / TANGENT]) + weight tracks | |
| **All meshes + all primitives** | |
| **Full node hierarchy + TRS** → prefab | |
| **Animations** → ExoticAnimation CCON (`.bin`) | |
| Albedo + **normal / pbrMap (ORM) / occlusion / emissive** | |
| Preserve Creator `.meta` sub-ids | |
| **Poly Haven fetch** → `importGltf` (`docs/polyhaven.md`) | |

## Library products

Root meta: `importer: "gltf"` (or `"fbx"`), `files: []`.

| Sub | Importer | Files |
|-----|----------|-------|
| mesh (per glTF mesh) | `gltf-mesh` | `.json` + `.bin` (multi-primitive; skinned stride 72; morph deltas) |
| texture | `texture` | `.json` |
| material | `gltf-material` | `.json` (builtin-standard: albedo / normal / pbrMap / occlusion / emissive) |
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
- E2E: `e2e-gltf.cjs`, `e2e-gltf-hierarchy.cjs`, `e2e-gltf-anim.cjs`, `e2e-gltf-skin.cjs`, `e2e-gltf-morph.cjs`, `e2e-gltf-pbr.cjs`, `e2e-polyhaven.cjs`, `e2e-fbx.cjs`
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
