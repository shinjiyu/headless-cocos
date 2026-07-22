# Getting started

Bring up headless preview against a Cocos Creator **3.8.8** project.

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| Node.js 20+ | Mirror and mini-packer |
| Creator 3.8.8 | One-time install for engine snapshot only |
| Target project | Same minor engine version; `assets/` present |
| Optional Docker | Docker Desktop 4.x (Windows/macOS) or Linux Docker |

Confirm Creator once by opening the project and clicking **Play**. That warms:

- `engine/bin/.cache/dev/preview/` (bundled `cc` + import-map)
- `temp/programming/packer-driver/targets/preview/` (optional baseline)
- `library/` (optional baseline; mini mode can rebuild it)

After the snapshot exists, Creator may stay closed.

## Engine snapshot

Snapshots live under `spike/engine-snapshot/` (gitignored):

```
spike/engine-snapshot/
├── preview/              # Creator engine preview cache
├── native-external/      # spine / meshopt wasm, …
└── internal-library/     # engine-builtin library products (effects, defaults)
```

### Automated helper

```powershell
cd <repo>
node .\spike\snapshot-from-creator.cjs
```

Set `CREATOR_ROOT` if Creator is not under the default Windows path.

### Manual copy (Windows)

```powershell
$creator = "C:\ProgramData\cocos\editors\Creator\3.8.8\resources\resources\3d\engine"
$out = ".\spike\engine-snapshot"
New-Item -ItemType Directory $out -Force | Out-Null
Copy-Item -Recurse "$creator\bin\.cache\dev\preview" "$out\preview"
Copy-Item -Recurse "$creator\native\external\emscripten" "$out\native-external\emscripten"
```

### Internal library

Engine builtins (internal bundle UUIDs) are imported into every project’s `library/` by Creator. When you wipe `library/` for importer testing, those products are gone.

Populate `internal-library/` by copying library entries **not** owned by any `assets/**/*.meta` uuid from a warmed project (see research session / `preview-mirror.mjs` `libResolve` fallback). Without it, mini mode with an empty `library/` fails with mass `/assets/internal/import/...` 404s.

### Programming packages (`tmp-asar-root`)

Mini-packer requires `@cocos/creator-programming-*` from Creator’s `app.asar` (not on public npm):

```powershell
npx @electron/asar extract `
  "C:\ProgramData\cocos\editors\Creator\3.8.8\resources\app.asar" `
  .\tmp-asar-root
```

Point `NPM_ROOT` / packer’s module resolution at that tree (Docker image vendors a traced subset under `/app/node_modules`).

## Local run

```powershell
$env:PACKER = "mini"
$env:PORT = "7460"
$env:PROJECT = "D:\path\to\project"
$env:ENGINE_SNAPSHOT = "$PWD\spike\engine-snapshot"
$env:LAUNCH_SCENE = "Main"
node .\spike\preview-mirror.mjs
```

Expected log lines:

```
[preview-mirror] http://127.0.0.1:7460
[mini] mode=on script=...\packer\build.cjs
[mini] watching ...\assets
[asset-sync] boot: N written, M unchanged, K media asset(s)
[mini] build#1 ok in …ms
```

Browser: `http://127.0.0.1:7460/` (omit `autoReload=false` to receive HMR).

### Relocated projects / Docker

Chunk filenames are `SHA1(file:///…/assets/…)`. If the project path changed since Creator last packed preview records, set:

```powershell
$env:PROJECT_URL = "file:///D:/original/path/to/project"
```

Use the path that appears inside `temp/programming/.../preview/main-record.json`.

## Importer wipe-test (recommended)

This is the authoritative check that importers work — not “reuse existing library”.

```powershell
# 1. Copy project
robocopy D:\proj\MyGame D:\temp\MyGame-mini /E /XD library build .git

# 2. Ensure empty library
Remove-Item D:\temp\MyGame-mini\library\* -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory D:\temp\MyGame-mini\library -Force | Out-Null

# 3. Run mini mode against the copy
$env:PACKER = "mini"
$env:PROJECT = "D:\temp\MyGame-mini"
$env:PROJECT_URL = "file:///D:/proj/MyGame"   # if import-map hashes need original URL
$env:ENGINE_SNAPSHOT = "$PWD\spike\engine-snapshot"
$env:LAUNCH_SCENE = "Main"
node .\spike\preview-mirror.mjs

# 4. Probe
$env:PROBE_URL = "http://127.0.0.1:7460/?autoReload=false"
node .\spike\probe-real-project.cjs
# Expect: engine up, launch scene name, failed requests = 0
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Mass `internal/import/*.json` 404 | Missing `internal-library` snapshot | Populate snapshot; rebuild Docker engine layer |
| `resources.load` fails; only `main` bundle | `resources` not preloaded | Mirror auto-adds `resources` to `preloadBundles` when discovered — update mirror |
| `custom-pipeline module not available` | Stale `settings.js` | Mirror rewrites settings from project `settings/v2/packages/*.json` |
| `CField is not a function` / decorator crash | Circular imports without CR guards | Ensure mini-packer uses `plugin-cr.cjs` + CR memory module |
| Chunks load but never overlay | `PROJECT_URL` hash mismatch | Align `PROJECT_URL` with Creator’s original `file:///` path |
| HMR silent on Docker Desktop | Bind-mount events don’t cross VM | `WATCH_POLL=1` |
| JPG textures 404 as `.png` | Old image importer `fmt` bug | Use current `importers/image.cjs` (`fmt` by extension) |
| `Can not parse JsonAsset` / missing board config | Plain JSON copied raw | Current mirror wraps as `cc.JsonAsset` |
| Spine wrong version | import-map still on empty/3.8 stub | Mirror reads `engine.json` / `SPINE_VERSION` |

## Next

- [Architecture](architecture.md)
- [Docker](docker.md)
- [Importers](importers.md)
