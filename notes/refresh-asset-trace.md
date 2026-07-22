# refresh-asset compile pipeline (traced 2026-07-17)

Trigger: edit `assets/scripts/HeadlessProbe.ts` (PROBE_VERSION 3→4), then
`Editor.Message.request('asset-db', 'refresh-asset', 'db://assets/scripts/HeadlessProbe.ts')`.

Hooks installed in Creator main process (pid 65548) via `cocosmcp_exec mode=eval`:

- fs.{writeFileSync,writeFile,appendFile,unlink,rename,copyFile,mkdir,rmdir,rm}(+Sync) + fs.promises.*
- child_process.{spawn,spawnSync,exec,execSync,execFile,execFileSync,fork}
- fs.watch(recursive) on `temp/programming/.../preview`, `library`, `temp/asset-db`, `assets`
- Editor.Message.request / send wrappers

Log: `d:\tempWorkspace\headless-cocos-research\trace\refresh-1784258883475.jsonl`

## Findings

### message-level

`Editor.Message.request('asset-db', 'refresh-asset', url)` returned `null` in **510ms**.

During that window main process invoked (in order):

1. `asset-db.query-assets  ccType=cc.Script`
2. `asset-db.query-asset-info uuid=<launch-scene-uuid>`
3. `scene.execute-scene-script  reference-image reference-image-refresh`
4. `scene.query-current-scene`
5. `reference-image notify-refresh` (send)

**Programming did NOT receive any explicit request.** Its handler must be
subscribed to asset-db events internally (`.workflow.build.ccc` lifecycle
hooks: `beforePreStart` / `afterPreStart` from package.json).

### fs hooks - main process only

Our `fs.*` wrappers logged **zero** project writes during the window,
even though the packer chunks WERE re-emitted on disk.

Explanation: the packer runs in a **child process / worker thread**, not
the main Electron process. To capture fs writes we'd need either
`child_process.spawn` interception + attach `--require` hook to the
spawned process, or another Frida-style approach.

### disk watchers - ground truth

`fs.watch(recursive)` DID see all changes. Ordered timeline:

```
0ms  asset-db  log/*.log         (Creator's own log)
10ms library   .assets            <- asset-db state
110ms library   .assets           (few flushes)
184ms preview   chunks/6d/6d8f..js
184ms preview   chunks/6d/6d8f..js.map
201ms preview   chunks/7d/7d06..js   <- HeadlessProbe rewritten
201ms preview   chunks/7d/7d06..js.map
204ms preview   *record*.tmp       <- staged writes
207ms preview   *record*.json      <- atomic rename
404ms library   .assets-info.json  <- asset-db metadata
405ms library   .assets-data.json
```

Note: chunk filenames are **content-independent** — hashed from the source
path, not source content. So `import-map.json` chunk pointer for
`HeadlessProbe.ts` stays identical across edits; only the file content
under that hash changes. Same-hash → cache-busting must be done via
mtime / manifest, not URL query.

### Which files change on a TS-edit refresh

**temp/programming/packer-driver/targets/preview/:**

- `chunks/<ab>/<40hex>.js` — new source per compile unit
- `chunks/<ab>/<40hex>.js.map` — sourcemap
- `import-map.json` (via .tmp + rename)
- `main-record.json` (via .tmp + rename)
- `assembly-record.json` (via .tmp + rename)
- `resolution-detail-map.json` (via .tmp + rename)

Also touched but content may not have logically changed:
`chunks/6d/6d8fd2b0...js(.map)` — probably a co-affected chunk from the
same assembly.

**library/:**

- `.assets`
- `.assets-data.json`
- `.assets-info.json`

These are asset-db's UUID / dep / info indexes. Notice `.internal-*.json`
did NOT change — those are only touched when built-in assets are
re-imported.

**Not touched on TS-edit:** individual `library/<ab>/<uuid>*` files.
That's an asset-only path.

## Next step (spike): reimplement packer

Enough to attempt a first cut:

Input:

- `assets/**/*.ts` + `tsconfig.cocos.json` from the project
- Existing `import-map.json` schema (readable, we just did)

Output:

- Rewrite the four record files atomically
- Emit chunk content matching what Creator produces

The compile itself can reuse `builtin/engine/static/engine-compiler/dist/index.js`
(plain JS in the asar). We snapshot / study its call contract first.

## Next step (also): main-only hook limitation

Since packer runs in a spawned worker, we don't see its own child_process
inheritance. Options to extend the trace:

1. Wrap `child_process.spawn/fork` to inject `NODE_OPTIONS=--require=hook`
   into the worker env. Requires our hook be reachable by absolute path.
2. Watch process list (electron helper processes) and correlate spawn
   time with which packer worker it is.
3. Skip and just use disk-watch outputs (already sufficient for spec).
