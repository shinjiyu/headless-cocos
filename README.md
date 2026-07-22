# Headless Cocos Research (Creator 3.8.8 asar)

Local research workspace: reverse-engineer Creator preview toward a **script + preview** headless service.

## Host editor

- Path: `C:\ProgramData\cocos\editors\Creator\3.8.8`
- asar: `resources\app.asar` (~709 MB)
- Also present: `2.4.15` (not primary)

## Layout

```
headless-cocos-research/
  scripts/           # extract / scan tools
  extracted/3.8.8/   # extracted packages (preview, programming, server, ...)
  notes/             # inventories + protocol notes
  package.json       # @electron/asar
```

## Quick commands

```powershell
cd d:\tempWorkspace\headless-cocos-research

# list asar (already done -> notes/asar-list-all.txt)
.\node_modules\.bin\asar.cmd list "C:\ProgramData\cocos\editors\Creator\3.8.8\resources\app.asar" > notes\asar-list-all.txt

# extract prefixes (Windows asar paths use backslash, no leading slash)
node .\scripts\extract-prefix.cjs `
  "C:\ProgramData\cocos\editors\Creator\3.8.8\resources\app.asar" `
  ".\extracted\3.8.8" `
  "builtin/preview" "builtin/programming" "builtin/server"
```

## Key finding (readable without decrypt)

`builtin/preview/static/views/script.ejs` already exposes the browser preview boot protocol (very close to cocos-cli / Cocos4):

- `/scripting/polyfills/bundle.js`
- `/scripting/engine/bin/.cache/dev/preview/import-map.json`
- project pack import-map + resolution detail map
- `/scripting/import-map-global`
- `/scripting/systemjs/system.js`
- `/scripting/engine/bin/.cache/dev/preview/bundled/index.js`
- `settings` script -> `window._CCSettings`
- `/preview-app/index.js` bootstrap
- scene fetch: `scene/${launchScene}.json`
- default HTTP port from server package: **7456**
- socket.io used for preview error / live signals

## Blocker

Most editor logic is shipped as **encrypted `.ccc`** (not plain JS). Source folders under `builtin/preview/source` are empty stubs; real code is `dist/**/*.ccc`.

Next research tracks: see `notes/00-status.md`.
## Test project

Self-serve harness: **baseAIAutoCocos** (Creator 3.8.8 + cocos-meta-mcp).

- Clone: `d:\tempWorkspace\baseAIAutoCocos` ← https://github.com/shinjiyu/baseAIAutoCocos
- Bridge port: dynamic (`instances.json`); preview port this session **7458**
- Live protocol capture: `notes/har/`, `notes/3.8-preview-protocol-live.md`
- Harness notes: `notes/test-harness-baseAIAutoCocos.md`

Agent can open Creator, switch MCP with `cocosmcp_use_project`, open preview, probe URLs without waiting on user.
