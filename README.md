# Headless Cocos

**Headless preview stack for Cocos Creator 3.8.x** — compile TypeScript, import assets, and hot-reload the browser preview **without** keeping the Creator IDE open.

> Validated on Creator **3.8.8**, Docker Desktop (Windows), and a production playable-ad project with a wiped `library/` rebuilt entirely by our importers.

---

## Why

Creator’s edit loop is heavy: Electron IDE → AssetDB → packer worker → preview. For AI agents and CI that only need “edit disk → see result”, that process is the bottleneck.

This repository replaces the IDE’s runtime role with a Node.js service that:

1. Serves the same HTTP/WebSocket surface as Creator’s preview
2. Compiles project scripts with a **mini-packer** built on `@cocos/creator-programming-*`
3. Imports assets into `library/` with headless **importers**
4. Pushes HMR reloads when files change

Creator is still useful for authoring and one-time snapshots. Day-to-day preview iteration does not require it.

---

## Features

| Area | Support |
|------|---------|
| Script compile | TypeScript / JavaScript → Creator-compatible preview chunks |
| Hot reload | `fs.watch` + optional polling (Docker Desktop bind mounts) |
| Images | PNG / JPG → `ImageAsset` + `Texture2D` + `SpriteFrame` |
| Audio | MP3 / WAV / OGG / AAC / M4A → `AudioClip` |
| Fonts | TTF → `TTFFont`; BMFont (`.fnt` + pages) → `BitmapFont` |
| Spine | 3.8 & 4.2 (`.skel` / JSON + atlas), version from project settings |
| Particles / atlases | `.plist` → `ParticleAsset` or `SpriteAtlas` |
| Text | `.txt` / `.csv` / `.yaml` / `.md` / … → `TextAsset` |
| JSON data | Plain JSON → `JsonAsset` (serialized wrapper) |
| Clips / graphs | `.anim` / `.animgraph` sync (+ marionette module when enabled) |
| Prefabs / scenes | JSON sync into `library/` |
| Bundles | Auto-discover `isBundle` folders; synthesize `config.json` / `index.js` |
| Engine builtins | Fallback `internal-library` snapshot (effects, default materials, …) |
| Docker | Self-contained image + compose for bind-mounted projects |

---

## Architecture

```
┌─────────────────────┐     edit assets/*      ┌──────────────────────┐
│  Cursor / CI / IDE  │ ─────────────────────▶ │  Cocos project       │
└─────────────────────┘                        │  (bind-mounted)      │
                                               └──────────┬───────────┘
                                                          │ watch
                                                          ▼
                                         ┌────────────────────────────────┐
                                         │     preview-mirror.mjs         │
                                         │  · importers → library/        │
                                         │  · mini-packer → preview-mini/ │
                                         │  · HTTP + WS HMR               │
                                         └───────────┬────────────────────┘
                                                     │
                          ┌──────────────────────────┼──────────────────────┐
                          ▼                          ▼                      ▼
                   engine-snapshot            library/ (+ internal)    browser preview
                   (cc + wasm)                imported products        :PORT
```

Two packer modes:

| `PACKER` | Behaviour | When to use |
|----------|-----------|-------------|
| `mini` | Importers rebuild `library/`; mini-packer rebuilds user scripts | **Default for headless / importer testing** |
| `creator` | Serve Creator’s existing `temp/.../preview` + `library` as-is | Fidelity baseline against IDE preview |

---

## Repository layout

```
headless-cocos/
├── spike/
│   ├── preview-mirror.mjs      # HTTP + HMR entry
│   ├── importers/              # image, audio, font, bmfont, spine, plist, text
│   ├── packer/build.cjs        # mini-packer
│   ├── e2e-*.cjs               # end-to-end probes
│   └── snapshot-from-creator.cjs
├── docker/
│   ├── build-context/          # Dockerfile + app copy
│   ├── docker-compose.yml
│   ├── docker-compose.playable.yml
│   └── docker-compose.playable-mini.yml
├── docs/                       # Detailed documentation
├── notes/                      # Research / reverse-engineering notes
└── scripts/                    # asar extract helpers
```

Large bake artifacts (`engine-snapshot/`, Docker `vendor/`, `node_modules/`) are **not** in git — generate them locally (see [Getting started](docs/getting-started.md)).

---

## Quick start

### Prerequisites

- Node.js **20+**
- Cocos Creator **3.8.8** installed once (to snapshot the engine cache)
- A Creator 3.8 project with `assets/` (and ideally warmed preview once)
- Optional: Docker Desktop for containerized preview

### 1. Clone

```bash
git clone https://github.com/shinjiyu/headless-cocos.git
cd headless-cocos
```

### 2. One-time engine snapshot

With Creator installed and a project previewed at least once:

```powershell
# Extract programming packages from app.asar (Windows paths)
npx @electron/asar extract `
  "C:\ProgramData\cocos\editors\Creator\3.8.8\resources\app.asar" `
  tmp-asar-root

# Snapshot engine preview + native wasm (+ optional internal-library)
node .\spike\snapshot-from-creator.cjs
```

Details: [Getting started](docs/getting-started.md#engine-snapshot).

### 3. Run locally (mini mode)

```powershell
$env:PACKER = "mini"
$env:PORT = "7460"
$env:PROJECT = "D:\path\to\your-cocos-project"
$env:ENGINE_SNAPSHOT = "$PWD\spike\engine-snapshot"
$env:LAUNCH_SCENE = "Main"   # optional: scene name or uuid
node .\spike\preview-mirror.mjs
```

Open [http://127.0.0.1:7460/](http://127.0.0.1:7460/).

### 4. Run in Docker

```powershell
cd docker
# After populating build-context/engine and vendor (see docs/docker.md)
docker build -t cocos-headless-preview:latest .\build-context
docker compose up -d
# → http://127.0.0.1:7460/
```

Playable-ad importer stress test (wiped `library/`):

```powershell
docker compose -f docker-compose.playable-mini.yml up -d
# → http://127.0.0.1:7463/
```

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PROJECT` | — | Absolute path to the Cocos project root |
| `PORT` | `7460` | HTTP listen port |
| `PACKER` | `creator` | `mini` \| `creator` |
| `ENGINE_SNAPSHOT` | — | Directory with `preview/`, `native-external/`, optional `internal-library/` |
| `PROJECT_URL` | — | Original `file:///…` URL used for chunk SHA1 (Docker / relocated projects) |
| `LAUNCH_SCENE` | auto | Scene uuid, name, or path fragment |
| `WATCH_POLL` | off | Set `1` on Docker Desktop bind mounts |
| `WATCH_POLL_MS` | `1000` | Poll interval |
| `MARIONETTE` | off | Force-enable marionette runtime redirects |
| `SPINE_VERSION` | from project | Override Spine runtime (`3.8` / `4.2`) |
| `CREATOR_ROOT` | Creator 3.8.8 path | Used when snapshot is absent |

---

## Verification

```powershell
# Smoke: navigate preview, assert scene + probe
node .\spike\probe-real-project.cjs

# HMR: edit TS → browser probe updates
node .\spike\e2e-hmr.cjs

# Importers (representative)
node .\spike\e2e-image-import.cjs
node .\spike\e2e-spine42-binary.cjs
node .\spike\e2e-plist.cjs
node .\spike\e2e-bundle.cjs
node .\spike\e2e-anim-text.cjs
```

Importer wipe-test (recommended): copy a project, delete `library/`, run with `PACKER=mini`, confirm the launch scene renders with **0 failed HTTP requests**.

---

## Documentation

| Doc | Topic |
|-----|--------|
| [Getting started](docs/getting-started.md) | Snapshot, local run, troubleshooting |
| [Architecture](docs/architecture.md) | Mirror, packer overlay, settings rewrite |
| [Importers](docs/importers.md) | Asset pipeline contracts |
| [Docker](docs/docker.md) | Image layout, compose, Windows quirks |
| [Bundles](docs/bundle-support.md) | Asset Bundle synthesis |
| [Real project boot](docs/real-project-boot.md) | Production project lessons |
| [Research notes](notes/) | asar / packer reverse-engineering |

---

## Limitations

- **Creator 3.8.x only** (validated on 3.8.8). Creator 2.x preview protocol differs.
- Auto sprite trim (`trimType: auto`) emits untrimmed rects (visually equivalent for transparent padding; no pixel decode in headless).
- Engine / internal-library snapshots must be produced from a licensed Creator install — not redistributed in this repo.
- 3D particle systems are out of scope for the current 2D playable pipeline.

---

## License

Research / internal tooling. Engine binaries and `@cocos/*` packages remain subject to Cocos Creator’s license — do not redistribute vendor trees or engine snapshots from a Creator install without compliance review.

---

## Related

- Sample harness project: [shinjiyu/baseAIAutoCocos](https://github.com/shinjiyu/baseAIAutoCocos)
- Upstream product: [Cocos Creator](https://www.cocos.com/en/creator)
