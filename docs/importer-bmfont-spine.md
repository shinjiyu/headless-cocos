# Headless BMFont + Spine importers (Cocos Creator 3.8 preview)

## BMFont (`spike/importers/bmfont.cjs`)

`*.fnt (BMFont text) + page PNG → cc.BitmapFont`

| file | type |
| --- | --- |
| `library/<xx>/<uuid>.json` | `cc.BitmapFont` dynamic JSON |
| (page PNG) | imported via the image importer — ImageAsset/Texture2D/SpriteFrame chain |
| `assets/**.fnt.meta` | `importer: "bitmap-font"` |

Engine contract (`cocos/2d/assets/bitmap-font.ts`, `text-processing.ts`):

- `spriteFrame`: `{__uuid__: <pageUuid>@f9941}` — the page image's SpriteFrame.
- `fntConfig.fontDefDictionary[charCode] = { rect{x,y,width,height}, xOffset,
  yOffset, xAdvance }` — consumed by `BitmapFont.onLoaded()` to build the
  letter atlas.
- `fntConfig.kerningDict[(first<<16)|second] = amount`.
- `fntConfig.fontSize` feeds `style.originFontSize`; `fntConfig.commonHeight`
  and `atlasName` are also read by the label pipeline.

The importer parses the standard BMFont text format (info/common/page/char/
kerning lines) and auto-imports the page PNG (so dropping `probe.fnt` +
`bmpage.png` with no metas is enough).

## Spine (`spike/importers/spine.cjs`)

`*.json or *.skel (Spine 3.8 or 4.2 export) + *.atlas + page PNGs → sp.SkeletonData`

| file | type |
| --- | --- |
| `library/<xx>/<uuid>.json` | `sp.SkeletonData` dynamic JSON |
| `library/<xx>/<uuid>.bin` | native skeleton bytes (`.skel` input only) |
| (page PNGs) | imported via the image importer |
| `assets/**.(json|skel).meta` | `importer: "spine-data"` |

Engine contract (`cocos/spine/skeleton-data.ts`):

- Serialized fields: `_skeletonJson` (the whole export object embedded),
  `_atlasText` (raw .atlas contents), `textures`
  (`{__uuid__: <pageUuid>@6c48a}` Texture2D refs, page order), `textureNames`
  (page file names), `scale`.
- Runtime hands these to `spine.wasmUtil.createSpineSkeletonDataWithJson` —
  the preview engine bundle ships BOTH Spine 3.8 and 4.2 wasm runtimes
  (`/engine_external/?url=external:emscripten/spine/<ver>/spine.wasm`).
- Binary exports follow Creator's exact product contract (confirmed against a
  real Creator project): the import JSON has `_skeletonJson: null` and
  `_native: ".bin"`; source `.skel` bytes are copied to `<uuid>.bin`. The
  normal native dependency pipeline downloads that ArrayBuffer and runtime
  calls `createSpineSkeletonDataWithBinary`.

**Detection**: any `assets/**.json` whose body has `skeleton.spine` is routed
to the spine importer; all `.skel` files are Spine binary exports; other
`.json` files keep the raw asset-sync path. Editing the sibling `.atlas`
re-imports either the `.json` or `.skel` skeleton.

**Runtime version is a project setting, not an engine limit.** Creator 3.8.8
ships both Spine 3.8 and 4.2 runtimes; a project picks one via
`settings/v2/packages/engine.json` → `spine._option` (`spine-3.8` /
`spine-4.2`). In the editor this maps to build-time constants
(`SPINE_3_8`/`SPINE_4_2`); in the preview bundle both module variants are
compiled in and the choice is made purely by two import-map lines
(`spine-version.js` / `spine-instantiate.js` → `-3.8` or `-4.2`). The mirror
reads the project setting (`detectSpineVersion`, override with env
`SPINE_VERSION`) and rewrites the served `preview/import-map.json`
accordingly — no engine rebuild. Exported assets must match the selected
runtime version (a 4.2 `.skel` needs `spine-4.2`).

## Verified (`e2e-bmfont-spine.cjs`)

Drops all five files with no metas; the container imports everything on its
own. Browser assertions:

- BMFont: `loadAny` → `BitmapFont` with `fontSize 32`, letter `A` def
  (20x24, xAdvance 22), 1 kerning pair, resolved page SpriteFrame, and a
  `cc.Label` using the font attaches into the scene without errors.
- Spine: `loadAny` → `SkeletonData`; `getRuntimeData()` parses through the
  wasm runtime (1 bone, 1 animation); an `sp.Skeleton` component with
  `setAnimation(0, 'idle')` attaches into the scene.
- Binary Spine (`e2e-spine-binary.cjs`): uses the official
  `spine-runtimes/3.8` spineboy fixture. Verifies import JSON + `.bin`, HTTP
  native `.bin` fetch, wasm binary parsing (64 bones, 11 animations),
  `sp.Skeleton.setAnimation(0, "walk")`, and actual rendered pixels. Screenshot:
  `spike/e2e-spine-binary.png`.
- Spine 4.2 runtime switch (`e2e-spine42-binary.cjs`): flips the project
  setting to `spine-4.2`, drops the official `spine-runtimes/4.2` spineboy
  fixture (`.skel` v4.2.22), and asserts the browser fetched the `/4.2/` wasm
  (and NOT `/3.8/`), parsed 67 bones / 11 animations, played `walk`, and
  rendered. Restores the setting on cleanup. Screenshot:
  `spike/e2e-spine42-binary.png`.

The polling watcher was also hardened during this test: its snapshot now
removes deleted entries and compares file size as well as mtime, so quickly
deleting/recreating an asset directory cannot hide re-added files.

Run with `--cleanup` to remove the test assets. Full regression (image,
audio, TS HMR) re-run green against the rebuilt Docker image.
