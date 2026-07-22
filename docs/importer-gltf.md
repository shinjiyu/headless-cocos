# glTF / GLB / FBX importer

Headless importer for Cocos Creator 3.8 mesh assets.

## Scope

| Supported | Not yet |
|-----------|---------|
| `.gltf` + external `.bin` / images | Skins / joints |
| `.glb` (JSON + BIN chunks) | Morph targets |
| `.fbx` via Creator `FBX2glTF` → glTF | Animation clips (`.bin` CCON) |
| POSITION / NORMAL / TEXCOORD_0 / TANGENT | Cameras / lights |
| **All meshes + all primitives** | |
| **Full node hierarchy + TRS** → prefab | |
| Albedo texture (URI or embedded) | |
| Preserve Creator `.meta` sub-ids | |

## Library products

Root meta: `importer: "gltf"` (or `"fbx"`), `files: []`.

| Sub | Importer | Files |
|-----|----------|-------|
| mesh (per glTF mesh) | `gltf-mesh` | `.json` + `.bin` (multi-primitive OK) |
| texture | `texture` | `.json` |
| material | `gltf-material` | `.json` (builtin standard) |
| scene | `gltf-scene` | hierarchy prefab |

Standard effect: `c8f66d17-351a-48da-a12c-0212d28575c4`.

## FBX

`importers/fbx.cjs` shells out to:

`{CREATOR}/resources/app.asar.unpacked/node_modules/@cocos/fbx2gltf/bin/Windows_NT/FBX2glTF.exe`

Override with `FBX2GLTF`. Intermediate file: `._fbx_<name>.glb` next to the `.fbx`.

## Code

- `spike/importers/gltf.cjs` — hierarchy + multi-prim
- `spike/importers/fbx.cjs` — FBX → glTF → importGltf
- Mirror: `PACKER=mini` boot + watcher
- E2E: `e2e-gltf.cjs` (sand), `e2e-gltf-hierarchy.cjs` (character-a)

## Verify

```powershell
node .\spike\e2e-gltf.cjs
node .\spike\e2e-gltf-hierarchy.cjs
```

Ground truth (`character-a.glb` from selfGame / Kenney):

- 6 meshes, sub-ids preserved (`@00956` …)
- Prefab: 9 nodes, 6 `MeshRenderer`, head scale `(0.1,0.1,0.1)`
