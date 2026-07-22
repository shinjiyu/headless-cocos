# Headless image importer (Cocos Creator 3.8 preview)

## Decision

Stay on Cocos. Do **not** reuse `.ccc` importers. Reimplement preview-compatible importers against Creator's **library product contract**.

## Phase 1 scope (done)

`PNG/JPG → ImageAsset + Texture2D + SpriteFrame`

Creator 3.8.8 product set for a sprite-frame image:

| file | type |
| --- | --- |
| `library/<xx>/<uuid>.json` | `cc.ImageAsset` (`fmt:"0"`, `w/h` may be 0) |
| `library/<xx>/<uuid>.png\|.jpg` | native bytes |
| `library/<xx>/<uuid>@6c48a.json` | `cc.Texture2D` |
| `library/<xx>/<uuid>@f9941.json` | `cc.SpriteFrame` |
| `assets/**.meta` | `importer:"image"` + fixed subMeta ids `6c48a` / `f9941` |

Code:
- `spike/importers/image.cjs`
- wired from `spike/preview-mirror.mjs` (boot + watch/poll)
- Docker image rebuilt with importer included

## Verified

1. Host `importImage()` writes the four library files + meta.
2. Docker poll sees host PNG overwrite and reimports (`[image-import] … 31x31` / `40x40`).
3. HTTP serves:
   - `/assets/*/import/<xx>/<uuid>.json`
   - `/assets/*/import/<xx>/<uuid>@….json`
   - `/assets/*/native/<xx>/<uuid>.png` (image bytes flow through the native dep)
   - `/query-extname/<uuid>`
4. Dynamic rewrite of `/assets/main/config.json` injects uuids + paths.
5. Browser `loadAny({uuid: spriteFrame})` returns the real SpriteFrame (correct w/h,
   texture, image element) — verified via `probe-image-load.cjs`.
6. Full loop green: `e2e-image-import.cjs` (host PNG 40x40 → 31x31 → browser
   SpriteFrame updates via HMR) and `e2e-hmr.cjs` (TS edit loop) both pass
   against the rebuilt Docker image.

## Root cause of the former "2×2 placeholder" gap (fixed)

Two independent bugs in `preview-mirror.mjs`, neither in the importer output:

1. **`/query-extname` returned `.png` for ImageAsset uuids.** Engine semantics
   (see `cocos/asset/asset-manager/editor-path-replace.ts` + `load.ts`): any
   non-empty answer makes the browser replace `.json` with that ext in the
   IMPORT url, then still parse the download with `parser.parseImport` →
   `deserialize(rawPngBytes)` → throws → dependency "missing" → placeholder.
   The only legal non-empty answer is `.cconb` (library holds a single `.bin`).
   Fix: return `''` for everything else. The PNG bytes are fetched separately
   through the asset's **native dependency** (`nativeUrl` →
   `/assets/<bundle>/native/<xx>/<uuid>.png`), which the mirror maps to
   `library/<xx>/<uuid>.png`.
   Same reason: never list images in bundle `extensionMap` — Config copies it
   onto `assetInfo.extension`, which the url-transformer applies to import urls.

2. **Synchronous polling watcher starved the event loop.** With `WATCH_POLL=1`
   on a Docker Desktop bind mount, each `readdirSync`/`statSync` takes
   milliseconds; scanning `library/` (~600 entries) took ~2.2s per tick and
   blocked every HTTP response for seconds (boot never finished, so earlier
   probes saw no requests at all). Fix: async non-overlapping scans with
   `fs.promises` + `setTimeout` rescheduling. Request latency: ~5s → ~10ms.

## Scene-level verification (done)

`spike/e2e-scene-sprite.cjs` proves the full no-IDE authoring loop:

1. Script drops a brand-new `assets/ui/hero.png` **without** a `.meta` — the
   container's polling importer generates the `.meta` (fresh uuid) and the four
   library files on its own.
2. Script appends a `cc.Node + cc.UITransform + cc.Sprite` block to
   `PreviewBoot.scene` by pure JSON edit, referencing the new SpriteFrame via
   `{"__uuid__": "<uuid>@f9941"}` (append-only so existing `__id__` refs stay
   valid); asset-sync pushes the scene to library and HMR reloads.
3. Headless Chrome confirms the Sprite resolves a real 64x64 SpriteFrame and a
   screenshot shows the red square rendered (`spike/e2e-scene-sprite.png`).
   Note: at runtime the SpriteFrame may be packed into the 2048x2048 dynamic
   atlas, so assert on `rect`, not `texture.width`.

Run with `--cleanup` to remove the test node + PNG afterwards.

## Next

1. Tier-1.5 importers as needed for playable ads: auto trim / atlas / audio.
2. Optional: `.cconb` (single `.bin`) assets are handled by the query-extname
   rule but have no importer yet.
