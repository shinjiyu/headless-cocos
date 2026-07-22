# Headless audio importer (Cocos Creator 3.8 preview)

## Scope

`MP3 / WAV / OGG / AAC / M4A → cc.AudioClip`

Library products (2 files, much simpler than images):

| file | type |
| --- | --- |
| `library/<xx>/<uuid>.json` | `cc.AudioClip` dynamic JSON (`_native: ".wav"`, `_duration`) |
| `library/<xx>/<uuid>.<ext>` | native audio bytes |
| `assets/**.meta` | `importer: "audio-clip"`, `files: [".json", ext]` |

Engine contract (from `cocos/audio/audio-clip.ts`):

- `_native` is a `@serializable` property on `Asset`, so the dynamic JSON just
  sets it; `_nativeDep` then drives the browser to fetch
  `/assets/<bundle>/native/<xx>/<uuid>.<ext>`, which the mirror maps to library.
- `_duration` is optional — `getDuration()` falls back to the runtime-decoded
  meta. We compute it for WAV (cheap header read) and store 0 otherwise.
- `/query-extname` must return empty for audio uuids (same rule as images).

## Code

- `spike/importers/audio.cjs`
- wired in `spike/preview-mirror.mjs`: boot scan, watch/poll handler, and
  `/assets/main/config.json` rewrite (`paths[uuid] = [dbPath, 'cc.AudioClip']`)
- audio MIME types added to the mirror

## Verified (e2e-audio-import.cjs)

1. Host script drops a synthesized 0.5s `assets/audio/beep.wav` with **no
   .meta** — the Docker importer generates the meta (fresh uuid) + 2 library
   files on its own.
2. Browser `loadAny({uuid})` resolves a real `cc.AudioClip`:
   `duration = 0.5`, `loadMode = 1` (Web Audio), correct `nativeUrl`.
3. Regression after image + audio wiring: `e2e-image-import` and `e2e-hmr`
   still pass against the rebuilt Docker image.

Run with `--cleanup` to remove the test files.

## Notes / limits

- No transcode: the bytes are served as-is; browser support decides which
  formats actually play (mp3/wav/ogg are safe on Chrome).
- `.pcm` is excluded (needs Creator-side conversion).
