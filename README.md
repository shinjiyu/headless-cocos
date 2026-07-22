<div align="center">

# Headless Cocos

### Creator 3.8 headless preview — no IDE required

[![GitHub stars](https://img.shields.io/github/stars/shinjiyu/headless-cocos?style=flat&logo=github)](https://github.com/shinjiyu/headless-cocos/stargazers)
[![License](https://img.shields.io/badge/license-Research-blue)](./README.md#license)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![Cocos Creator](https://img.shields.io/badge/Cocos%20Creator-3.8.8-orange)](https://www.cocos.com/en/creator)
[![Docker](https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white)](./docs/docker.md)
[![Importers](https://img.shields.io/badge/importers-wipe%20tested-success)](./docs/importers.md)

Compile TypeScript · Import assets · Hot-reload preview — **without** keeping Creator open.

[Documentation](./docs/README.md)
·
[中文文档](./README.zh-CN.md)
·
[Architecture](./docs/architecture.md)
·
[Docker](./docs/docker.md)
·
[GitHub](https://github.com/shinjiyu/headless-cocos)

</div>

---

## Notice — What this is

A **Node.js preview stack** that replaces Cocos Creator’s IDE runtime for edit → preview loops (AI agents, CI, remote machines).

Validated on Creator **3.8.8**, Docker Desktop (Windows), and a production **playable-ad** project with `library/` wiped and rebuilt entirely by our importers.

```bash
git clone https://github.com/shinjiyu/headless-cocos.git
cd headless-cocos
# after engine snapshot — see Getting started
PACKER=mini PORT=7460 PROJECT=/path/to/project \
  ENGINE_SNAPSHOT=$PWD/spike/engine-snapshot \
  node spike/preview-mirror.mjs
```

---

## Why

Creator’s edit loop is heavy: Electron IDE → AssetDB → packer worker → preview. For agents and CI that only need “edit disk → see result”, that process is the bottleneck.

This repository replaces the IDE’s runtime role with a service that:

1. Serves the same HTTP / WebSocket surface as Creator preview  
2. Compiles project scripts with a **mini-packer** (`@cocos/creator-programming-*`)  
3. Imports assets into `library/` with headless **importers**  
4. Pushes HMR reloads when files change  

Creator remains useful for authoring and one-time snapshots. Day-to-day preview iteration does not require it.

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
| JSON data | Plain JSON → `JsonAsset` |
| Clips / graphs | `.anim` / `.animgraph` (+ marionette when enabled) |
| Prefabs / scenes | JSON sync into `library/` |
| Bundles | Auto-discover `isBundle`; synthesize `config.json` / `index.js` |
| Engine builtins | Fallback `internal-library` snapshot |
| Docker | Self-contained image + compose for bind-mounted projects |

---

## Architecture

```
┌─────────────────────┐     edit assets/*      ┌──────────────────────┐
│  Cursor / CI / IDE  │ ─────────────────────▶ │  Cocos project       │
└─────────────────────┘                        └──────────┬───────────┘
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
```

| `PACKER` | Behaviour | When to use |
|----------|-----------|-------------|
| `mini` | Rebuild `library/` + user scripts | **Headless / importer testing** |
| `creator` | Serve Creator’s existing preview + library | Fidelity baseline vs IDE |

Deep dive: [docs/architecture.md](./docs/architecture.md)

---

## Quick start

### Prerequisites

- Node.js **≥ 20**
- Cocos Creator **3.8.8** (one-time, for engine snapshot)
- A 3.8 project with `assets/`
- Optional: Docker Desktop

### Clone

```bash
git clone https://github.com/shinjiyu/headless-cocos.git
cd headless-cocos
```

### One-time engine snapshot

```powershell
npx @electron/asar extract `
  "C:\ProgramData\cocos\editors\Creator\3.8.8\resources\app.asar" `
  tmp-asar-root

node .\spike\snapshot-from-creator.cjs
```

Details: [Getting started](./docs/getting-started.md)

### Run (mini mode)

```powershell
$env:PACKER = "mini"
$env:PORT = "7460"
$env:PROJECT = "D:\path\to\your-cocos-project"
$env:ENGINE_SNAPSHOT = "$PWD\spike\engine-snapshot"
$env:LAUNCH_SCENE = "Main"
node .\spike\preview-mirror.mjs
```

Open **http://127.0.0.1:7460/**

### Docker

```powershell
cd docker
docker build -t cocos-headless-preview:latest .\build-context
docker compose up -d
```

Importer wipe-test (empty `library/`):

```powershell
docker compose -f docker-compose.playable-mini.yml up -d
# → http://127.0.0.1:7463/
```

---

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `PROJECT` | — | Cocos project root |
| `PORT` | `7460` | HTTP port |
| `PACKER` | `creator` | `mini` \| `creator` |
| `ENGINE_SNAPSHOT` | — | `preview/` + `native-external/` + optional `internal-library/` |
| `PROJECT_URL` | — | Original `file:///…` for chunk SHA1 (Docker / relocated projects) |
| `LAUNCH_SCENE` | auto | Scene uuid, name, or path fragment |
| `WATCH_POLL` | off | `1` on Docker Desktop bind mounts |
| `SPINE_VERSION` | from project | `3.8` \| `4.2` |
| `MARIONETTE` | off | Force marionette runtime |

---

## Verification

```powershell
node .\spike\probe-real-project.cjs
node .\spike\e2e-hmr.cjs
node .\spike\e2e-image-import.cjs
node .\spike\e2e-spine42-binary.cjs
node .\spike\e2e-plist.cjs
node .\spike\e2e-bundle.cjs
```

**Authoritative importer check:** copy a project → delete `library/` → `PACKER=mini` → launch scene renders with **0 failed requests**.

---

## Documentation

| Doc | Topic |
|-----|--------|
| [中文 README](./README.zh-CN.md) | 中文总览 |
| [Getting started](./docs/getting-started.md) | Snapshot, first run, troubleshooting |
| [Architecture](./docs/architecture.md) | Mirror, packer overlay, settings |
| [Importers](./docs/importers.md) | Asset pipeline contracts |
| [Docker](./docs/docker.md) | Image bake & compose |
| [Bundles](./docs/bundle-support.md) | Asset Bundle synthesis |
| [Docs index](./docs/README.md) | Full index |

---

## Limitations

- **Creator 3.8.x only** (validated on 3.8.8)
- Auto sprite trim emits untrimmed rects (no pixel decode)
- Engine / `internal-library` snapshots are **not** in git — generate locally
- 3D particles out of scope for the current 2D playable pipeline

---

## License

Research / internal tooling. Engine binaries and `@cocos/*` packages remain under **Cocos Creator’s license** — do not redistribute vendor trees or engine snapshots without compliance review.

---

## Related

- Sample harness: [shinjiyu/baseAIAutoCocos](https://github.com/shinjiyu/baseAIAutoCocos)
- Upstream: [Cocos Creator](https://www.cocos.com/en/creator)
