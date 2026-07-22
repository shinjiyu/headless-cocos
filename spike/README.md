# preview-mirror spike

Disk-first Creator 3.8 preview server. Goal: prove we can boot preview **without** Creator Express for the common path.

## Run

```powershell
cd d:\tempWorkspace\headless-cocos-research
$env:PORT='7460'
$env:PROJECT='d:/tempWorkspace/baseAIAutoCocos'
# optional fallback:
# $env:PREVIEW_UPSTREAM='http://127.0.0.1:7458'
node .\spike\preview-mirror.mjs
```

Open: http://127.0.0.1:7460/?autoReload=false

## Disk mounts

| URL prefix | Source |
|------------|--------|
| `/scripting/x/*` | `{project}/temp/programming/packer-driver/targets/preview/*` |
| `/scripting/engine/bin/.cache/dev/preview/*` | Creator install engine preview cache |
| `/assets/general/import/*` | `{project}/library/*` |
| `/assets/main|internal/*` | `spike/cache/assets/*` (snapshot) |
| `/scene/<uuid>.json` | `{project}/library/<ab>/<uuid>.json` |
| shell/settings/polyfills/systemjs/preview-app | `spike/cache/*` |
| `/socket.io/socket.io.js` | noop stub |

## Still needed for full headless

1. Generate `settings.js` + bundle `config.json` without Creator (today: snapshot)
2. Map remaining `/assets/...` native textures / pack files that appear at runtime
3. Script recompile without Creator (`programming` packer) after TS edits
4. Optional: decrypt `.ccc` to steal middleware generators for (1)

## Hot reload (resource change)

| Layer | Status |
|-------|--------|
| Disk change → browser reload | **Yes** — watches packer / library / assets / asset-db, pushes `browser:reload` |
| Manual reload | `POST http://127.0.0.1:7460/__reload` |
| TS/scene recompile | Still needs Creator (or MCP `refresh-asset`) to update packer/library on disk |

Open preview **without** `autoReload=false`:

```text
http://127.0.0.1:7460/
```

Flow today:

1. Edit `assets/**/*.ts` (or scene)
2. Creator / MCP compiles → writes `temp/programming/.../preview` + `library`
3. Mirror watch fires → browser reloads → serves new chunks

## Verified (2026-07-16)

`node spike/boot-test.cjs` against `:7460` (no Creator Express):

- Scene **PreviewBoot** loads
- `__HEADLESS_PROBE__ === 2` (`HeadlessProbe.ts` from packer chunks)
- HTTP **badCount = 0**

Helpers: `snapshot-from-creator.cjs`, `patch-settings.cjs`, `use-har-settings.cjs`, `hmr-smoke.mjs`.

Mirror also rewrites empty/`current_scene` `launchScene` → `PreviewBoot` uuid at serve time.
