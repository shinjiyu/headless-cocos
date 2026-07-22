# Docker

Run the headless preview stack in Linux containers. Verified on **Docker Desktop** (Windows) with the Linux engine.

## Image layout

```
/app
  preview-mirror.mjs
  packer/build.cjs
  importers/
  cache/                 # preview shell
  node_modules/          # traced @cocos/creator-programming-* (+ deps)
  vendor-utils/          # compressUUID helper
/engine
  preview/
  native-external/
  internal-library/      # required for wiped-library / mini mode
/workspace               # bind-mounted Cocos project
/entrypoint.sh           # PROJECT_URL → /workspace symlink
```

`ENGINE_SNAPSHOT=/engine` is set in the Dockerfile.

## Bake prerequisites (not in git)

Before `docker build`, populate `docker/build-context/`:

| Path | Source |
|------|--------|
| `engine/` | Copy of `spike/engine-snapshot/` (`preview`, `native-external`, `internal-library`) |
| `vendor/node_modules` | Traced `@cocos/*` tree from `tmp-asar-root` (see historical `docs/docker-setup.md` notes) |
| `vendor/utils` | Creator `uuid` util (`compressUUID`) |
| `app/` | Sync from `spike/` (mirror, packer, importers, cache) |

```powershell
# Typical sync after local changes
Copy-Item .\spike\preview-mirror.mjs .\docker\build-context\app\preview-mirror.mjs -Force
Copy-Item .\spike\importers\* .\docker\build-context\app\importers\ -Force
Copy-Item .\spike\packer\* .\docker\build-context\app\packer\ -Force
robocopy .\spike\engine-snapshot .\docker\build-context\engine /E /NFL /NDL /NJH /NJS
```

## Compose profiles

| File | Port | Mode | Mount |
|------|------|------|-------|
| `docker-compose.yml` | 7460 | mini (default) | sample / configured project |
| `docker-compose.playable.yml` | 7462 | **creator** | playable ad (reuse project library) |
| `docker-compose.playable-mini.yml` | 7463 | **mini** | playable copy with **empty library** |

Always prefer **playable-mini** when validating importers.

### Required env for mini against relocated projects

```yaml
environment:
  PACKER: mini
  PROJECT: /workspace
  PROJECT_URL: "file:///D:/original/Windows/path"
  ENGINE_SNAPSHOT: /engine
  LAUNCH_SCENE: "Main"
  WATCH_POLL: "1"
  WATCH_POLL_MS: "800"
```

`entrypoint.sh` creates a symlink so `fileURLToPath(PROJECT_URL)` resolves to `/workspace` inside the container (chunk hashing + mod-lo `stat`).

## Build & run

```powershell
cd docker
docker build -t cocos-headless-preview:latest .\build-context
docker compose -f docker-compose.playable-mini.yml up -d --force-recreate
docker logs -f cocos-preview-playable-mini
```

Healthy signs:

```
[preview-mirror] http://127.0.0.1:7463
[mini] mode=on
[spine-import] …
[asset-sync] boot: N written, …
[mini] build#1 ok in …
```

Probe from host:

```powershell
$env:PROBE_URL = "http://127.0.0.1:7463/?autoReload=false"
$env:SETTLE_MS = "10000"
node ..\spike\probe-real-project.cjs
```

## Windows / Docker Desktop quirks

1. **No inotify across the VM** — set `WATCH_POLL=1`.
2. **Drive-letter case** — mini-packer normalizes `D:` uppercase for SHA1 stability.
3. **PROJECT_URL** — must match Creator’s original Windows `file:///` prefix when overlaying Creator import-maps.
4. **Bind-mount path** — use `d:/…` style in compose `volumes:`.

## Updating code in the image

Mirror/importers are copied into the image at build time (not bind-mounted). After code changes:

```powershell
Copy-Item …  # sync app/
docker build -t cocos-headless-preview:latest .\build-context
docker compose -f <compose> up -d --force-recreate
```

The **project** is bind-mounted — asset/script edits do not need a rebuild.

## Related

- Historical detail / dep-trace notes: [docker-setup.md](docker-setup.md) (older path assumptions; prefer this doc for current compose)
- [Getting started](getting-started.md)
- [Architecture](architecture.md)
