# Architecture

How `preview-mirror.mjs`, the mini-packer, and importers cooperate to replace Creator’s preview process.

## Components

| Component | Path | Role |
|-----------|------|------|
| Preview mirror | `spike/preview-mirror.mjs` | HTTP server, path mapping, HMR, settings rewrite, importer orchestration |
| Mini-packer | `spike/packer/build.cjs` | Compiles `assets/**/*.{ts,js}` into Creator-shaped chunks |
| CR plugin | `spike/packer/plugin-cr.cjs` | Circular-reference guards (Creator’s `plugin-detect-circular`) |
| Importers | `spike/importers/*.cjs` | Source assets → `library/<xx>/<uuid>.*` |
| Engine snapshot | `spike/engine-snapshot/` | Bundled `cc` + wasm + optional `internal-library` |
| Preview shell cache | `spike/cache/` | `index.html`, polyfills, SystemJS, preview-app stubs |

## Request mapping

Creator preview URLs are remapped to disk:

| URL | Source |
|-----|--------|
| `/scripting/x/chunks/*` | `preview-mini/` overlay, else Creator `preview/` |
| `/scripting/x/{import-map,*-record,resolution-detail-map}.json` | Creator `preview/` (keeps engine module entries) |
| `/scripting/engine/bin/.cache/dev/preview/*` | `ENGINE_SNAPSHOT/preview` or live Creator cache |
| `/assets/{bundle}/import|native/<xx>/<uuid>.*` | Project `library/` then `internal-library/` |
| `/assets/{bundle}/config.json` | Snapshot cache, or synthesized for project bundles |
| `/scene/<uuid>.json` | `library/<xx>/<uuid>.json` |
| `/settings.js` | Snapshot shell, rewritten with project settings |
| `/__hmr` | WebSocket → `{ type: 'browser:reload', … }` |
| `/localization-editor/*` | Synthesized from `localization-editor/translate-data/*.yaml` |

## Packer overlay rule

Chunk id = `SHA1(moduleURL)` (path-based, not content-based). Editing a file keeps the same chunk URL.

**Only** chunk bytes prefer `preview-mini/`. Records stay from Creator’s `preview/` because they also index engine modules (`cce:/internal/x/cc`, prerequisite-imports, …) that mini intentionally omits.

```
import-map.json  ──► Creator preview/     (required)
chunks/<sha>.js  ──► preview-mini/ if present, else preview/
```

If the project is relocated, set `PROJECT_URL` so mini hashes match the URLs already stored in Creator’s import-map.

## Mini mode boot sequence

When `PACKER=mini` and `WATCH≠0`:

1. `bootSyncAssets()` walks `assets/`
   - Media → typed importers
   - JSON → Spine / JsonAsset / verbatim sync
   - Prefab / scene / anim / animgraph / mtl → copy into `library/`
2. `runMiniBuild('boot')` compiles all scripts
3. Watchers:
   - `.ts/.js` → debounced mini-build → HMR
   - Media / JSON assets → importer / sync → HMR on library change
4. Polling watcher optional (`WATCH_POLL=1`) for Docker Desktop

Creator mode skips importers and only watches Creator-owned outputs.

## Settings rewrite

Snapshot `settings.js` is project-agnostic. On each request the mirror injects:

- `launch.launchScene` from `LAUNCH_SCENE` or first / preferred scene
- `assets.projectBundles` including discovered bundles
- `assets.preloadBundles` — adds `{ bundle: 'resources' }` when that folder is a bundle
- Engine modules / macros / design resolution / custom layers / render pipeline from `settings/v2/packages/*.json`

Without this, real projects often fail with `custom-pipeline` errors or miss `cc.resources`.

## Import-map rewrite (engine)

Also rewritten at serve time:

- Spine 3.8 vs 4.2 runtime selection (`engine.json` / `SPINE_VERSION`)
- Marionette empty stubs removed when the project includes `marionette` (or `MARIONETTE=1`)

## Library resolution

```text
libResolve(rel):
  1. PROJECT/library/rel
  2. ENGINE_SNAPSHOT/internal-library/rel   (if present)
```

Project-owned products always win. Engine builtins come from the snapshot after a wipe.

## Bundle synthesis

Folders with `isBundle: true` in `.meta` are discovered. For `/assets/<name>/config.json` and `index.js`:

- Collect imported uuids under that folder
- Emit Creator-shaped `config.json` (paths, types, versions)
- Emit a minimal `index.js` register stub

See [bundle-support.md](bundle-support.md).

## Circular dependency handling

Creator’s preview babel pipeline wraps imports involved in cycles with `_crd` guards so decorators can load before bindings settle.

Mini-packer:

1. Injects virtual module `cce:/internal/code-quality/cr.mjs`
2. Runs `plugin-cr.cjs` (scope-safe reimplementation of `plugin-detect-circular`)
3. Filters out `cc` / `cc/env` / `db://` from guarding

Without this, projects using custom decorator stacks (e.g. `@CField`) crash at boot.

## HMR protocol

Clients open `ws://host:PORT/__hmr`. On successful rebuild or library write, mirror broadcasts:

```json
{ "type": "browser:reload", "reason": "mini:assets/scripts/Foo.ts", "seq": 12 }
```

Debounce: `RELOAD_DEBOUNCE_MS` (default 400). Manual trigger: `POST /__reload`.

## Security / licensing note

The mirror does not ship Cocos engine source. It serves a **local snapshot** produced from an installed Creator. Treat snapshots and vendored `@cocos/*` trees as proprietary artifacts of that install.
