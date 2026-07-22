# glTF / GLB / FBX importer

Headless importer for Cocos Creator 3.8 mesh assets.

## Scope

| Supported | Not yet |
|-----------|---------|
| `.gltf` + external `.bin` / images | Morph targets |
| `.glb` (JSON + BIN chunks) | Cameras / lights |
| `.fbx` via Creator `FBX2glTF` → glTF | |
| POSITION / NORMAL / TEXCOORD_0 / TANGENT | |
| **JOINTS_0 / WEIGHTS_0** + `gltf-skeleton` | |
| **All meshes + all primitives** | |
| **Full node hierarchy + TRS** → prefab | |
| **Animations** → ExoticAnimation CCON (`.bin`) | |
| Albedo texture (URI or embedded) | |
| Preserve Creator `.meta` sub-ids | |

## Library products

Root meta: `importer: "gltf"` (or `"fbx"`), `files: []`.

| Sub | Importer | Files |
|-----|----------|-------|
| mesh (per glTF mesh) | `gltf-mesh` | `.json` + `.bin` (multi-primitive OK; skinned stride 72) |
| texture | `texture` | `.json` |
| material | `gltf-material` | `.json` (builtin standard) |
| skeleton (per skin) | `gltf-skeleton` | `.json` (`_joints` paths + `_bindposes`) |
| animation (per clip) | `gltf-animation` | `.bin` only (CCON v2 ExoticAnimation) |
| scene | `gltf-scene` | hierarchy prefab + `Animation` / `SkeletalAnimation` |

Standard effect: `c8f66d17-351a-48da-a12c-0212d28575c4`.

## FBX

`importers/fbx.cjs` shells out to:

`{CREATOR}/resources/app.asar.unpacked/node_modules/@cocos/fbx2gltf/bin/Windows_NT/FBX2glTF.exe`

Override with `FBX2GLTF`. Intermediate `.glb` is written under `os.tmpdir()/fbx2gltf-<hash>/` (mtime-cached).

## Code

- `spike/importers/gltf.cjs` — hierarchy + multi-prim + animations + skins
- `spike/importers/ccon.cjs` — CCON v2 encode/decode (vendored notepack)
- `spike/importers/fbx.cjs` — FBX → glTF → importGltf
- Mirror: `PACKER=mini` boot + watcher
- E2E: `e2e-gltf.cjs`, `e2e-gltf-hierarchy.cjs`, `e2e-gltf-anim.cjs`, `e2e-gltf-skin.cjs`, `e2e-fbx.cjs`

## Verify

```powershell
node .\spike\e2e-gltf.cjs
node .\spike\e2e-gltf-hierarchy.cjs
node .\spike\e2e-gltf-anim.cjs --disk-only
node .\spike\e2e-gltf-skin.cjs
node .\spike\e2e-gltf-skin.cjs --fbx
node .\spike\e2e-fbx.cjs
```

Ground truth (`character-a.glb` from selfGame / Kenney):

- 6 meshes, sub-ids preserved (`@00956` …)
- Prefab: 9 nodes, 6 `MeshRenderer`, head scale `(0.1,0.1,0.1)`
- 27 animation clips (idle `@1f586`), ExoticAnimation paths match Creator

Skinned ground truth (Creator `soldier.FBX` / perlab):

- 4 skeletons (`@30732` …), 4 skinned meshes (stride 72)
- Prefab: 4 `SkinnedMeshRenderer` + `SkeletalAnimation`
