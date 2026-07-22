# Status — 2026-07-16

## Goal

Build our own headless preview for Creator **3.8** projects (script-driven + browser preview), using:

1. Cocos4 / cocos-cli preview architecture as blueprint
2. Creator 3.8.8 `app.asar` as ground truth for 3.8 protocol

## Done

- [x] Located asar: Creator **3.8.8** (+ 2.4.15)
- [x] Full asar file list -> `notes/asar-list-all.txt`
- [x] Extracted `builtin/preview`, `builtin/programming`, `builtin/server`
- [x] Mapped preview **message API** from `preview/package.json` (open-terminal, reload-terminal, generate-settings, programming:compiled, ...)
- [x] Mapped browser boot URLs from `static/views/script.ejs` + `preview-app/src/main.ts`
- [x] Confirmed default preview port **7456** (`builtin/server`)

## Important facts

### Packages that matter for headless preview

| Package | Role |
|---------|------|
| `builtin/preview` | Preview manager, settings, browser template, preview-app |
| `builtin/programming` | Script packer / compile pipeline (quick pack) |
| `builtin/server` | Express + socket.io HTTP preview host |
| `builtin/builder` | `getPreviewSettings` / build settings (not yet extracted) |
| `builtin/asset-db` | Needed if settings depend on library; maybe defer if scripts-only |

### `.ccc` format

Hex samples start with non-zlib plaintext (high entropy). String search finds **zero** of `preview`/`settings`/`express` inside `.ccc`. Treat as **encrypted bytecode**; cannot read with asar extract alone.

`source/` trees exist as directory markers but contain **no TS files** in the asar — only compiled `dist/*.ccc`.

### Already-readable gold

1. `extracted/3.8.8/builtin/preview/static/views/script.ejs` — full SystemJS boot chain
2. `extracted/3.8.8/builtin/preview/preview-app/src/*.ts` — engine init + `scene/<id>.json` load
3. `package.json` message maps for preview / programming / server
4. Cocos4 `cocos-cli` `core/preview/*` — parallel architecture (open source)

## Next tracks (priority)

### A. Protocol capture (fastest win, no decrypt)

1. Open any 3.8 project, start browser preview
2. DevTools Network -> save HAR to `notes/har/`
3. Diff URL list vs `script.ejs` + cocos-cli `scripting-routes.ts`
4. Produce `notes/3.8-preview-protocol.md` (must-have routes)

### B. Runtime `.ccc` dump (needed for server middleware logic)

Hook Electron main / renderer after Creator loads:

- Find `Module._extensions['.ccc']` or equivalent loader
- Dump decrypted Buffer/string on first require of:
  - `builtin/preview/dist/contributions/server.ccc`
  - `builtin/preview/dist/browser/preview-manager.ccc`
  - `builtin/preview/dist/browser/preview-settings.ccc`
  - `builtin/server/dist/express.ccc`

Possible approaches: `--require` preload, Frida, or patch asar loader entry.

### C. Minimal headless spike

After A: implement Node HTTP server that serves:

- static preview shell (from ejs)
- stub `_CCSettings`
- proxy or reuse project's `library` + scripting cache under `temp/`

Script compile can initially still call Creator (`refresh-asset` / programming) until B unlocks packer.

## Non-goals (for now)

- Full scene/node MCP
- Asset-db CRUD
- Replacing entire Creator IDE

## Update 2026-07-16 evening

- Cloned **baseAIAutoCocos** as autonomous test bed
- Creator launched; MCP on dynamic port; preview live on **7458**
- Confirmed 3.8 uses `/settings.js` (cocos-cli `/preview/settings.js` is 404)
- Also saw `/scripting/x/import-map.json` in live HTML
- Next: dump more routes from index + start thin static mirror experiment

## Update 2026-07-17 ~01:20

### Breakthrough

Built `spike/preview-mirror.mjs` — disk-first preview on **:7460**.

Confirmed without Creator Express proxy:

- HTML / settings / polyfills / systemjs / preview-app
- engine preview bundle (~19MB) from Creator install cache
- packer chunks from `temp/programming/packer-driver/targets/preview`
- scene JSON + library imports
- main/internal bundle config snapshots

### Meaning

True headless for **script+preview** does **not** require reinventing Cocos4 first.
Biggest remaining gap is **generation** (settings + bundle config + packer) after script edits — today those still come from Creator once, then can be served headlessly.

## Update 2026-07-17 ~01:50 — full script boot

`boot-test.cjs` on mirror `:7460` (Creator Express **not** required):

- `scene: "PreviewBoot"`
- `__HEADLESS_PROBE__ === 2`
- console: `[HeadlessProbe] ready v=2`
- HTTP badCount **0**

### Fixes that unblocked

1. `/scene/current_scene.json` → PreviewBoot uuid (also rewrite `settings.js` launchScene)
2. Project settings with `CUSTOM_PIPELINE_NAME: Custom` caused `pass.getBinding` crash — use stock/HAR-like Builtin pipeline settings for headless boot
3. Scene script `__type__` was stale (`78c8b…`); aligned to script compressed id `6bfb5n25yxKvrVUsXF25j4d`

### Next

- Spike packer refresh after TS edit without Creator UI
- Regenerate project-accurate `settings.js` / bundle configs without GUI
