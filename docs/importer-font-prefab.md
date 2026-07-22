# Headless TTF font importer + prefab loop (Cocos Creator 3.8 preview)

## TTF font importer

`TTF → cc.TTFFont` — `spike/importers/font.cjs`

Library products:

| file | type |
| --- | --- |
| `library/<xx>/<uuid>.json` | `cc.TTFFont` dynamic JSON |
| `library/<xx>/<uuid>/<name>.ttf` | native bytes — **in a subdirectory** |
| `assets/**.meta` | `importer: "ttf-font"` |

Engine contract (`cocos/2d/assets/ttf-font.ts` + `url-transformer.ts` combine):

- `_native` holds the **file name** (`"probefont.ttf"`), not just an extension.
- The url combiner special-cases `.ttf`: native URL becomes
  `<base>/<xx>/<uuid>/<name>.ttf` (WeChat filename workaround baked into the
  engine), so the library must mirror that subdirectory layout. The mirror's
  existing `/native/` route already passes the extra path segment through.
- The browser's font downloader registers a CSS `@font-face`; the resolved
  `TTFFont._fontFamily` is `"<name>_LABEL"`, which `cc.Label._font` consumes.

Verified by `e2e-font-import.cjs`: drop `assets/fonts/probefont.ttf` (no meta,
copy of arial.ttf) → auto import → browser `loadAny` resolves
`TTFFont { fontFamily: "probefont_LABEL" }`. Run with `--cleanup` to remove.

Woff/eot/svg are also downloadable by the engine but out of scope for now
(extend `FONT_EXTS` if ever needed). BMFont (.fnt) not implemented.

## Prefab loop (no importer needed)

Prefabs are plain JSON — the existing asset-sync (assets → library copy)
already covers them; there was just no end-to-end proof. `e2e-prefab.cjs`:

1. Writes `assets/prefabs/HeroCard.prefab` from scratch: `cc.Prefab` header +
   `cc.Node` + `cc.UITransform` + `cc.Label` + `cc.PrefabInfo`, and a `.meta`
   with a fresh uuid (`importer: "prefab"`).
2. asset-sync pushes it to `library/<xx>/<uuid>.json`.
3. Browser: `loadAny({uuid})` → `cc.Prefab`, `cc.instantiate(prefab)` →
   node tree added under Canvas with the Label text intact
   (`"HEADLESS PREFAB OK"`, 300x80 UITransform).

Notes for AI-authored prefabs:

- Root object is `cc.Prefab` with `data: {__id__:1}`; the root node's
  `_prefab` points at a `cc.PrefabInfo` whose `root`/`asset` reference
  `__id__` 1/0. `fileId` can be any stable string.
- Reference other assets (SpriteFrame etc.) with
  `{"__uuid__": "<uuid>@f9941", "__expectedType__": "cc.SpriteFrame"}` —
  same as in scenes.

## Status summary (headless Docker preview asset support)

| type | mechanism | verified by |
| --- | --- | --- |
| TS/JS scripts | mini-packer chunks + HMR | `e2e-hmr.cjs` |
| scene / material / anim JSON | asset-sync copy | `e2e-scene-sprite.cjs` |
| prefab JSON | asset-sync copy | `e2e-prefab.cjs` |
| PNG/JPG → SpriteFrame | `importers/image.cjs` | `e2e-image-import.cjs`, `e2e-scene-sprite.cjs` |
| mp3/wav/ogg → AudioClip | `importers/audio.cjs` | `e2e-audio-import.cjs` |
| TTF → TTFFont | `importers/font.cjs` | `e2e-font-import.cjs` |
| .fnt → BitmapFont | `importers/bmfont.cjs` | `e2e-bmfont-spine.cjs` |
| Spine 3.8 JSON / `.skel` → sp.SkeletonData | `importers/spine.cjs` | `e2e-bmfont-spine.cjs`, `e2e-spine-binary.cjs` |

See `importer-bmfont-spine.md` for the BMFont/Spine contracts.
Explicitly out of scope: DragonBones (per project decision), auto-atlas,
texture compression. Spine JSON and binary exports are both supported, but
must target Spine 3.8.x.
