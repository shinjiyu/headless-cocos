# glTF / GLB importer

Headless MVP importer for Cocos Creator 3.8 static glTF 2.0 assets.

## Scope

| Supported | Not yet |
|-----------|---------|
| `.gltf` + external `.bin` / images | Skins / joints |
| `.glb` (JSON + BIN chunks) | Morph targets |
| POSITION / NORMAL / TEXCOORD_0 / TANGENT | Animations / cameras / lights |
| Albedo texture (URI or embedded) | Multi-primitive meshes (first only) |
| `cc.Mesh` + `.bin`, `cc.Material`, `cc.Texture2D`, prefab | Full node hierarchy (scene 0 → single MeshRenderer) |
| Preserve Creator `.meta` sub-ids | FBX (use `@cocos/fbx2gltf` later) |

## Library products

Root meta: `importer: "gltf"`, `files: []`.

Sub-assets (ids preserved from existing meta when present):

| Sub | Importer | Files |
|-----|----------|-------|
| mesh | `gltf-mesh` | `.json` + `.bin` |
| texture | `texture` | `.json` (mipmaps → ImageAsset uuid) |
| material | `gltf-material` | `.json` (builtin standard effect) |
| scene | `gltf-scene` | `.json` prefab array |

Standard effect uuid: `c8f66d17-351a-48da-a12c-0212d28575c4` (from `internal-library`).

## Code

- `spike/importers/gltf.cjs`
- Wired in `preview-mirror.mjs` (`PACKER=mini` boot + watcher)
- E2E: `spike/e2e-gltf.cjs` (fixture: Kenney `sand.glb` from selfGame / assetsSrc)

## Verify

```powershell
# unit-style (no browser): import matches Creator vert/idx/bin size
node -e "/* see branch notes */"

# with mirror on :7460 PACKER=mini
node .\spike\e2e-gltf.cjs
```

Ground-truth check against Creator on `sand.glb`:

- verts `60`, indices `96`, bin `3072` bytes
- sub-ids `@46899` / `@96c50` / `@9991c` / `@406e2` preserved from meta

## Test assets

- Repo fixture: `spike/fixtures/gltf-kenney-sand/`
- Source project: `D:\workspace\selfGame\assets\AssetPool\kenney\...`
- Future: PolyHaven models via [assetsSrcAPI](https://github.com/shinjiyu/assetsSrcAPI) `PolyHavenProvider`
