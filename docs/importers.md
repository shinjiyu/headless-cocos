# Importers

Headless replacements for Creator AssetDB import steps used by **preview**. Goal: given `assets/` + `.meta` uuids, produce `library/` products that the engine deserializer accepts.

## Pipeline overview

```
assets/<path>.<ext>  (+ .meta)
        │
        ▼
  importer / sync
        │
        ▼
library/<uuid[0:2]>/<uuid>.json      # serialized asset
library/<uuid[0:2]/><uuid>.<native>  # optional bytes (png, mp3, …)
library/<uuid[0:2]/><uuid>@xxxx.json # sub-assets (texture, spriteFrame, …)
```

Boot: `bootSyncAssets()` in `preview-mirror.mjs`.  
Incremental: asset watcher in `PACKER=mini` mode.

## Coverage matrix

| Source | Importer | Primary type(s) | Notes |
|--------|----------|-----------------|-------|
| `.png` `.jpg` `.jpeg` | `importers/image.cjs` | `ImageAsset`, `Texture2D`, `SpriteFrame` | `fmt` by extension; auto-trim → untrimmed rect |
| `.mp3` `.wav` `.ogg` `.aac` `.m4a` | `importers/audio.cjs` | `AudioClip` | Native copy + JSON |
| `.ttf` | `importers/font.cjs` | `TTFFont` | |
| `.fnt` + page PNGs | `importers/bmfont.cjs` | `BitmapFont` | |
| `.skel` / Spine JSON + `.atlas` | `importers/spine.cjs` | `sp.SkeletonData` | 3.8 & 4.2; runtime via import-map |
| `.plist` | `importers/plist.cjs` | `ParticleAsset` or `SpriteAtlas` | Auto-classified |
| `.gltf` `.glb` | `importers/gltf.cjs` | `Mesh` / `Material` / `Texture2D` / prefab | Static mesh MVP; see [importer-gltf.md](importer-gltf.md) |
| `.txt` `.csv` `.yaml` `.yml` `.conf` `.md` | `importers/text.cjs` | `TextAsset` | |
| Plain `.json` (no `__type__`) | mirror `importJsonAsset` | `JsonAsset` | Wraps `{ json: … }` |
| Spine JSON | spine importer | `SkeletonData` | Detected via `isSpineJson` |
| `.prefab` `.scene` `.anim` `.animgraph` `.mtl` | sync copy | same JSON | Creator already stores preview form as JSON/CCON |
| Serialized `.json` with `__type__` | sync copy | as-is | |

## Design rules

1. **Respect `.meta` uuids** — never regenerate project uuids; scenes/prefabs depend on them.
2. **Match Creator preview products**, not necessarily build-pipeline compressed textures.
3. **Idempotent writes** — skip disk write when content unchanged (avoids watch echo).
4. **No pixel decode for auto-trim** — `trimType: auto` metas often hold stale rects; emit full image rect (transparent padding is visually equivalent). Honor `trimType: custom` when dimensions still match.
5. **Sub-asset ids** — texture `@6c48a`, spriteFrame `@f9941` (Creator conventions).

## Image `fmt` table

`cc.ImageAsset.content.fmt` indexes the engine’s extension list used to rebuild the native URL:

| Ext | `fmt` |
|-----|-------|
| `.png` | `0` |
| `.jpg` | `1` |
| `.jpeg` | `2` |
| `.bmp` | `3` |
| `.webp` | `4` |

Wrong index → 404 (`…uuid.png` requested for a `.jpg` file).

## JsonAsset vs sync

| Content | Action |
|---------|--------|
| Spine skeleton JSON | Spine importer |
| Root / first element has `__type__` | Sync verbatim (already a serialized asset) |
| Other parseable JSON | Wrap as `cc.JsonAsset` |
| Unparseable | Skip |

## Deep dives

| Topic | Doc |
|-------|-----|
| Images / SpriteFrame | [importer-image.md](importer-image.md) |
| Audio | [importer-audio.md](importer-audio.md) |
| TTF + prefab notes | [importer-font-prefab.md](importer-font-prefab.md) |
| BMFont + Spine | [importer-bmfont-spine.md](importer-bmfont-spine.md) |
| Plist particles / atlases | [importer-plist.md](importer-plist.md) |
| glTF / GLB meshes | [importer-gltf.md](importer-gltf.md) |
| Animation + TextAsset | [importer-anim-text.md](importer-anim-text.md) |

## E2E tests

| Script | Covers |
|--------|--------|
| `spike/e2e-image-import.cjs` | PNG replace → HMR → SpriteFrame size |
| `spike/e2e-audio-import.cjs` | AudioClip |
| `spike/e2e-font-import.cjs` | TTFFont |
| `spike/e2e-bmfont-spine.cjs` | BMFont + Spine JSON |
| `spike/e2e-spine-binary.cjs` | Spine 3.8 `.skel` |
| `spike/e2e-spine42-binary.cjs` | Spine 4.2 `.skel` |
| `spike/e2e-plist.cjs` | Particle + SpriteAtlas |
| `spike/e2e-gltf.cjs` | glTF Mesh + Prefab |
| `spike/e2e-anim-text.cjs` | AnimationClip + AnimationGraph + TextAsset |
| `spike/e2e-bundle.cjs` | Custom bundle loadBundle + path load |
| `spike/e2e-prefab.cjs` / `e2e-scene-*.cjs` | Prefab / scene sync |

## Known gaps

- Texture compression / auto-atlas packing (preview usually uses raw)
- True auto-trim recomputation (needs alpha decode)
- 3D particle systems
- Creator 2.x asset formats
