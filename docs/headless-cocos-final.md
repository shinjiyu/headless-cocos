# Headless Cocos Creator 3.8 Preview

> **Status:** proven working end-to-end. Cocos Creator IDE process is not running.
> AI edits `.ts` on disk → browser reloads with new code in ~2s.

## 1. Problem

Original workflow (baseAIAutoCocos):
- Cocos Creator 3.8.8 IDE must be open.
- Cocos-meta-mcp bridges MCP tool calls into the running editor.
- Every AI change (script edit, scene tweak, asset add) goes through the
  editor's `refresh-asset` → renderer packer worker → disk → preview reload.
- Editor is heavy (>2GB RAM, slow boot, Electron), locks the project, and
  the compile+import roundtrip dominates iteration latency.

Question: can we **replace the editor's role** with a pure Node stack that
- compiles TS to Creator-compatible packer chunks,
- serves the preview HTTP surface,
- reacts to disk edits with HMR,
- and does not require the Creator process to be alive?

Answer: **yes, for TS-only iteration.**

## 2. What we built

Three pieces, all under `d:\tempWorkspace\headless-cocos-research\`:

```
spike/
├── preview-mirror.mjs   # HTTP + WS server; disk-first preview + HMR
├── packer/
│   ├── build.cjs        # mini-packer CLI (replaces Creator's packer-driver)
│   └── package.json
└── engine-snapshot/     # 91 MB, snapshot of Creator's engine cache
    ├── preview/         # bundled engine + import-map (76 MB)
    └── native-external/ # emscripten wasm (14 MB)
```

Run mode:

```powershell
$env:PACKER = "mini"
$env:PORT   = "7460"
$env:ENGINE_SNAPSHOT = "d:\tempWorkspace\headless-cocos-research\spike\engine-snapshot"
node d:\tempWorkspace\headless-cocos-research\spike\preview-mirror.mjs
# Open http://127.0.0.1:7460/  in any Chromium-based browser.
```

Edit a `.ts` under `assets/`, the mirror sees `fs.watch`, spawns
`packer/build.cjs`, waits for exit, then pushes `browser:reload` over
WebSocket. Total wall time from save to `probe = N+1` in the browser: **~2 s**.

## 3. Why it works: the packer landscape

Creator's script compile stack is **already plain npm packages**, published
into `resources/app.asar/node_modules/@cocos/`. Only the driver code around
them is compiled to `.ccc` (V8 bytecode). The heavy lifting isn't:

| Package | Role | Version in 3.8.8 |
|---|---|---|
| `@cocos/creator-programming-quick-pack`  | user-script pack driver | 1.7.2 |
| `@cocos/creator-programming-mod-lo`      | module loader + babel transformer | 1.12.0 |
| `@cocos/creator-programming-common`      | URL/logger/asserts | 1.2.3 |
| `@cocos/creator-programming-import-maps` | import-map parser | 1.0.0 |
| `@cocos/creator-programming-babel-preset-cc` | preset that adds `_cclegacy._RF.push(uuid,...)`, `__checkObsolete__`, hot dispose | 1.x |

By constructing a `ModLo` and a `QuickPack` with the right options, feeding
it `assets/**/*.ts` + `.ts.meta` UUIDs, we produce the same
`temp/programming/packer-driver/targets/preview/` layout the editor writes:

- `chunks/<xx>/<sha1>.js`          — one chunk per source module
- `chunks/<xx>/<sha1>.js.map`      — sourcemap
- `import-map.json`                — module → chunk map
- `main-record.json`               — mtime + resolutions
- `assembly-record.json`           — chunk graph
- `resolution-detail-map.json`     — resolver detail

**Chunk id = SHA1(module URL)**, not content-hash. So editing a file keeps the
same chunk filename — the mirror can serve either the editor's or ours from
the same URL and downstream code keeps working. This is what lets us
**overlay** mini output on top of Creator's engine-side output.

## 4. Architecture

```
┌────────────────────────────┐             ┌─────────────────────────┐
│  AI / Cursor / any IDE     │  edits *.ts │  d:/…/baseAIAutoCocos   │
│                            │────────────▶│  /assets/...            │
└────────────────────────────┘             └─────────────┬───────────┘
                                                          │ fs.watch
                                                          ▼
                        ┌───────────────────────────────────────────┐
                        │        preview-mirror.mjs  (Node)         │
                        │                                           │
                        │  ┌─────────────────────────────────────┐  │
                        │  │  spawn packer/build.cjs             │  │
                        │  │  → QuickPack + ModLo                │  │
                        │  │  → writes preview-mini/chunks/*.js  │  │
                        │  └─────────────────────────────────────┘  │
                        │                                           │
                        │  HTTP:  /scripting/x/chunks/*   ─┐        │
                        │         /scripting/engine/...   ─┼─▶ disk │
                        │         /scene/<uuid>.json      ─┘        │
                        │  WS  :  /__hmr  →  browser:reload         │
                        └───────────────────────────────────────────┘
                                          ▲             ▲
                              engine snapshot (91MB)    │
                                                 chunks + records
                                                       ▲
                                                       │ overlay:
                                                       │ mini > preview
```

Overlay rule (in `mapPath`): only `/scripting/x/chunks/*` prefers `preview-mini/`;
records (`import-map.json`, `main-record.json`, `assembly-record.json`,
`resolution-detail-map.json`) always fall back to Creator's `preview/`.
This is deliberate — Creator's records also index engine chunks
(`cce:/internal/x/cc`, prerequisite-imports, engine internals) that the mini
build intentionally does not emit. Since chunk filenames are SHA1(URL), our
freshly built HeadlessProbe chunk **lands at exactly the URL Creator's
import-map already points to** and gets served transparently.

## 5. Getting from cold-start to running preview

### 5.1 One-time prep

```powershell
# 1. Extract app.asar so Node can require @cocos packages from it
cd d:\tempWorkspace\headless-cocos-research
npx @electron/asar extract `
  "C:\ProgramData\cocos\editors\Creator\3.8.8\resources\app.asar" `
  tmp-asar-root

# 2. Snapshot the engine preview cache once
$creator = "C:\ProgramData\cocos\editors\Creator\3.8.8\resources\resources\3d\engine"
mkdir spike\engine-snapshot -Force | Out-Null
Copy-Item -Recurse "$creator\bin\.cache\dev\preview"  spike\engine-snapshot\preview
Copy-Item -Recurse "$creator\native\external\emscripten"  spike\engine-snapshot\native-external\emscripten
```

Snapshot must be produced **once from a fully-warmed Creator** (open the
project, hit Play once, so Creator caches the whole engine bundle). After
that, Creator can be closed forever.

### 5.2 Boot the mirror

```powershell
$env:PACKER          = "mini"
$env:PORT            = "7460"
$env:ENGINE_SNAPSHOT = "d:\tempWorkspace\headless-cocos-research\spike\engine-snapshot"
$env:PROJECT         = "d:\tempWorkspace\baseAIAutoCocos"
node d:\tempWorkspace\headless-cocos-research\spike\preview-mirror.mjs
```

You'll see:

```
[preview-mirror] http://127.0.0.1:7460
[mini] mode=on script=…\spike\packer\build.cjs
[mini] watching …\baseAIAutoCocos\assets
[mini] build#1 start (boot)
[mini] build#1 ok in ~1000ms      # cold; subsequent 80–120ms
[hmr] browser:reload mini:boot
```

### 5.3 Verify the edit-loop

```powershell
node d:\tempWorkspace\headless-cocos-research\spike\e2e-hmr.cjs
```

Expected end: `[e2e] SUCCESS — headless edit-loop confirmed`.

## 6. Measured behaviour

Test project: `baseAIAutoCocos` (1 script, ~9 engine chunks, PreviewBoot scene).

| Metric | Value |
|---|---|
| Cold mini-build (`build#1`) | ~1000 ms (Node + @cocos deps load) |
| Warm mini-build (per edit) | 80–120 ms |
| E2E edit→browser probe change | ~2 s (build + WS + reload + engine boot) |
| Engine snapshot size | 91 MB (76 preview + 14 emscripten) |
| Chunk output byte-diff vs Creator | Structurally identical; mini adds `ccHot?.dispose(…)` (hot=true) |
| Chunk hash (`SHA1(fileURL)`) | Identical to Creator's for the same source path |

Verified with Creator process **fully killed** (`CocosCreator.exe` +
`Cocos Helper.exe` gone, ports 3921/7456 empty). Only `node` on 7460
serves the whole preview.

## 7. Files and where they live

### 7.1 Production files (keep)

| Path | Purpose |
|---|---|
| `spike/preview-mirror.mjs`     | HTTP + WS mirror; `PACKER=mini` + JSON-asset sync |
| `spike/packer/build.cjs`       | mini-packer CLI (~150 LoC) |
| `spike/packer/package.json`    | mini-packer metadata |
| `spike/engine-snapshot/`       | one-time-produced engine cache (91 MB) |
| `spike/cache/`                 | preview shell (`index.html`, `settings.js`, socket.io stub, etc.) |
| `spike/e2e-hmr.cjs`            | E2E: `.ts` edit → probe change |
| `spike/e2e-scene-edit.cjs`     | E2E: `.scene` edit via mini asset-db → node rename visible |
| `spike/boot-test.cjs`          | one-shot smoke: navigate + assert `probe` and 0 4xx |

### 7.2 Investigation artefacts (reference, not runtime)

| Path | Purpose |
|---|---|
| `tmp-asar-root/`             | extracted `app.asar`; source of `@cocos/*` packages |
| `notes/refresh-asset-trace.md` | how Creator's own `refresh-asset` moves data (fs/child_process/message trace) |
| `notes/packer-landscape.md`  | why user-script compile is pure npm code |
| `notes/packer-api-contract.md` | reverse-engineered `QuickPack` + `ModLo` API |
| `trace/refresh-*.jsonl`      | hook logs from Creator injection (see hook-inject.cjs comments in transcript) |

## 8. Key implementation notes

### 8.1 `_compressUUID` must NOT be `true`
The signature is `compressUUID(uuid, s?)`. Passing `s=true` gives a 22-char
compressed UUID; Creator's convention is 23 chars with a 5-hex prefix
(default `s=undefined`). Use `(u) => uuidUtils.compressUUID(u)` — no second
argument. Getting this wrong makes `_cclegacy._RF.push(...)` register the
class under an unknown id, and scene deserialization fails to find
`HeadlessProbe`.

### 8.2 `setAssetPrefixes` + `setUUID` are required
Without these, `ModLo` won't classify the module as an "asset" and the
babel preset won't emit the `_cclegacy._RF.push({}, "<compressed>", …)` /
`_RF.pop()` pair. Runtime looks fine at first, but `ccclass('HeadlessProbe')`
can't be looked up by UUID when the scene JSON references it.

### 8.3 Windows drive-letter case matters
`SHA1(pathToFileURL(x).href)` is CASE-SENSITIVE. `d:\` and `D:\` produce
different chunk filenames. `build.cjs`'s `normalize()` upper-cases the drive
letter unconditionally so hashes are stable no matter how the CLI was
invoked. This was the single bug that broke the E2E loop on the 2nd run.

### 8.4 Only overlay `chunks/*`, not records
Mini's `import-map.json` intentionally lacks engine entries. Serving it as
the top-level import-map breaks the browser (`cc` unresolved, scene never
boots). Records stay from Creator's `preview/`, chunk bytes come from mini.

### 8.5 Chunk-writer is unconditional
`ChunkWriter.addChunk` unconditionally `fs.outputFileSync`s the code. There
is no incremental "did content change?" gate. Every `build()` re-emits
touched chunks. Safe to run every save; the cost is dominated by Node
+ @cocos require boot on the first invocation.

## 9. What we deliberately did NOT do

- **Rebuild the engine.** The engine snapshot is treated as an opaque
  81 MB blob produced by Creator once. Refreshing the snapshot requires
  Creator briefly (rerun Play, re-copy).
- **Full `asset-db` for native-processed assets.** Images (mipmaps),
  fbx (gltf), materials with texture refs — anything Creator would emit
  additional `library/<xx>/<uuid>.<native>` files for — still needs the
  editor's importer once. Once imported, `library/` state is durable
  and can be checked into git.
- **Full `.ccc` decompilation.** They're V8 bytecode. Instead we
  identified that the interesting code (packer, mod-lo) is plain JS in
  npm packages sitting next to the `.ccc` files.

## 9b. Mini asset-db (JSON-only)

Live sync from `assets/**/*.{prefab,scene,mtl,anim,json}` → `library/<xx>/<uuid>.json`.
Sits inside `preview-mirror.mjs` (`SYNC_EXTS`, `syncAssetToLibrary`, `bootSyncAssets`).

Why it's OK to be a byte-copy: for these formats Creator itself does not
transform the file — `assets/PreviewBoot.scene` and its
`library/23/23ed…json` are SHA256-identical (verified). Meta only supplies
the destination UUID; no import step is required.

Boot behavior: on mirror start, walks `assets/`, syncs any missing/differing
library entry. Steady-state: `fs.watch` on `assets/` triggers per-file
`syncAssetToLibrary(file)` on save; that write in turn fires the pre-existing
`library/` watcher → `browser:reload`.

E2E verified: edit `_name: "Canvas"` → `_name: "MiniAssetDBWorks"` in
`assets/scene/PreviewBoot.scene` → browser scene tree shows the new name
in ~2 s (test at `spike/e2e-scene-edit.cjs`).

Not covered (Creator still owns these):
- `.png` / `.jpg` / textures — need mipmap generation, block compression
- `.fbx` / `.gltf` — need conversion via `@cocos/fbx2gltf`
- `.effect` — need shader compilation into `effect.bin`
- Anything whose meta produces additional native binaries under
  `library/<xx>/<uuid>.<ext>` beyond `.json`

## 10. Follow-ups (open work)

1. **Native-processed assets** (textures, meshes, effects). Extend the
   mini asset-db with per-importer emitters — likely by calling into
   `@cocos/ccbuild` and `@cocos/fbx2gltf` (both are npm-installable and
   already present in `tmp-asar-root/node_modules`).
2. **Multi-project support.** `PROJECT` and `NPM_ROOT` are envs, but the
   engine snapshot is per-Creator-install. Splitting it into a shared
   cache per Creator version is straightforward.
3. **Vendor `@cocos/*` deps into `spike/packer/node_modules/`**, so the
   `tmp-asar-root` extraction step goes away. Requires publishing decisions
   from Cocos or a `npm pack` shim.
4. **Kill the browser dep on engine snapshot.** Currently the engine is
   Creator's bundled preview build (uses `System.register` + the specific
   `cc` chunk). Building the engine ourselves via `@cocos/ccbuild`
   (already in tmp-asar-root/node_modules) would remove the last Creator
   artefact. Feasible; not on the critical path yet.
5. **Auto-refresh engine snapshot** when Creator is upgraded. Simple
   script that diffs `resources/resources/3d/engine/bin/.cache/dev/preview`.

## 11. Comparison to the previous stack

| Concern | Cocos Creator + cocos-meta-mcp | Headless mini-packer + mirror |
|---|---|---|
| Startup | ~15 s (Creator boot) | ~1 s (Node) |
| RAM footprint | ~2 GB (Electron) | ~150 MB (Node) |
| Compile latency | 300–800 ms (renderer worker) | 80–120 ms (subprocess) |
| Edit → visible in browser | 2–4 s | ~2 s |
| Locks project? | Yes (`.lock` files) | No |
| GUI required? | Yes | No |
| MCP required? | Yes (to trigger `refresh-asset`) | No |
| Handles prefabs/scenes? | Yes (all types) | Yes for JSON-only assets; native-processed (images/fbx) still TODO (§10.1) |
| Handles engine upgrade? | Automatic | Manual snapshot refresh |

For the current "AI-writes-Cocos-TS" workflow the second column is
strictly better. Prefab/scene editing is the missing link before it fully
replaces the Creator+MCP path.
