# Headless `.plist` importer — particles + sprite atlases (Creator 3.8 preview)

## Scope

A `.plist` is ambiguous, so the importer dispatches on file **content**:

| content | asset | notes |
| --- | --- | --- |
| `maxParticles` / `emitterType` / `particleLifespan` | `cc.ParticleAsset` (2D particles) | for `ParticleSystem2D` |
| `frames` + `metadata` (TexturePacker) | `cc.SpriteAtlas` + per-frame `cc.SpriteFrame` | TexturePacker format 2 & 3 |

This is the same file-type split Creator uses (`importer: "particle"` vs
`importer: "sprite-atlas"`).

## Particle (`cc.ParticleAsset`)

Library products:

| file | type |
| --- | --- |
| `library/<xx>/<uuid>.json` | `cc.ParticleAsset` (`_native: ".plist"`, `spriteFrame` ref) |
| `library/<xx>/<uuid>.plist` | native config bytes |
| `assets/**.plist.meta` | `importer: "particle"`, `files: [".json", ".plist"]` |

Engine contract (`cocos/particle-2d/particle-{asset,system-2d}.ts`):

- `ParticleAsset` is a plain ccclass — only `spriteFrame` is serialized. The
  emitter config is **not** parsed at import time; the engine already registers
  `.plist` with `downloadText` + `parsePlist`, so at runtime the native
  dependency is fetched and parsed into `file._nativeAsset` (a dict).
- `ParticleSystem2D._applyFile()` reads `file._nativeAsset` via
  `_initWithDictionary` (maxParticles, gravity, colors, sizes…) and takes its
  texture from `file.spriteFrame`.
- The importer therefore auto-imports the sibling image named by the plist's
  `textureFileName` (via the image importer) and points `ParticleAsset.spriteFrame`
  at that SpriteFrame — so no remote/relative texture fetch is needed. (The plist
  still carries `textureFileName`; the engine's fallback `loadRemote` for it 404s
  harmlessly and is ignored because `spriteFrame` is already set.)

## Sprite atlas (`cc.SpriteAtlas`)

Library products:

| file | type |
| --- | --- |
| `library/<xx>/<uuid>.json` | `cc.SpriteAtlas` — `{__type__, content:{name, spriteFrames:[key,id,...]}}` |
| `library/<xx>/<uuid>@<sub>.json` | one `cc.SpriteFrame` per frame (custom `content` serialize) |
| `assets/**.plist.meta` | `importer: "sprite-atlas"`, subMetas per frame |

Engine contract (`cocos/2d/assets/{sprite-atlas,sprite-frame}.ts`):

- `SpriteAtlas._deserialize` expects `{name, spriteFrames:[key, uuid, key, uuid…]}`
  under `content`.
- Each frame becomes a `cc.SpriteFrame` sub-asset (`<atlasUuid>@<sub>`) whose
  `content` carries `rect`, `offset`, `originalSize`, `rotated`, and `texture`
  (the page's Texture2D `@6c48a`). The atlas page PNG is auto-imported via the
  image importer.
- `<sub>` ids are `md5(frameName)[:5]` (deterministic, deduped on collision).
- TexturePacker format 2 (`frame`/`offset`/`sourceSize`/`rotated`) and format 3
  (`textureRect`/`spriteOffset`/`spriteSourceSize`/`textureRotated`) are parsed;
  format 0 flat keys are a best-effort fallback. Rotated frames pass the flag and
  packed rect through (unrotated is the tested path).

## Code

- `spike/importers/plist.cjs` — minimal plist XML parser + content dispatch +
  both importers.
- wired in `spike/preview-mirror.mjs`: `.plist` MIME, boot scan, watch/poll
  handler (`isTracked` includes `plist`), `collectHeadlessAssets`
  (reads `importer` from meta), and `/assets/main/config.json` rewrite
  (`paths[uuid] = [dbPath, 'cc.SpriteAtlas'|'cc.ParticleAsset']`, plus each
  sub SpriteFrame uuid).

## Verified (`e2e-plist.cjs`)

Drops both fixtures into `assets/plist/` with no metas; the container imports
both on its own. Browser assertions:

- **Particle**: `loadAny(uuid)` → `cc.ParticleAsset` (`_native ".plist"`);
  `ParticleSystem2D.file =` it → `totalParticles === 64`, `emitterMode === 0`
  (gravity), a resolved `spriteFrame`, component attached and simulating (the
  screenshot shows the emitted particle spray).
- **Sprite atlas**: `loadAny(uuid)` → `cc.SpriteAtlas` with 2 frames
  (`left`/`right`), `getSpriteFrame('left')` has `rect 64×64` on the shared
  `128×64` page texture, and a `cc.Sprite` using it renders into the scene.

Screenshot: `spike/e2e-plist.png`. Run with `--cleanup` to remove the fixtures.

Regression after wiring: image, audio, TTF, BMFont, Spine JSON, Spine 3.8/4.2
binary, prefab, and TS HMR e2e all still pass against the rebuilt Docker image.

## Notes / limits

- 3D `ParticleSystem` (component-based) has no separate asset file — its config
  lives in the scene/prefab JSON (already synced) and its texture/material go
  through the image / `.mtl` paths; not covered here.
- Embedded-texture particle plists (`textureImageData`, gzip+base64) are not
  wired to `spriteFrame`; provide `textureFileName` (sibling image) instead.
- No texture compression / auto-atlas packing (untrimmed preview path only).
