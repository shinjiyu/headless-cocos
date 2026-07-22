# Packer API contract

## QuickPack (@cocos/creator-programming-quick-pack)

```ts
new QuickPack({
  modLo: ModLo,          // uniform module loader (see below)
  origin: string,        // URL origin for resolving specifiers (e.g. "project:/")
  workspace: string,     // output dir - our "temp/programming/packer-driver/targets/preview/"
  sourceMaps?: boolean | 'inline',
  verbose?: boolean,
  logger?: Logger,
})

.build(
  specifiers: Iterable<string | URL>,           // entry modules
  { retryResolutionOnUnchangedModule?, cleanResolution? }?
): Promise<{ depsGraph: Record<string, string[]> }>
```

Instantiated in Creator's RENDERER process (Editor UI), NOT the main
process — that's why our main-process module hooks saw no per-trigger
`require()` for the packer core. The rendered process holds a long-lived
`QuickPack` instance that receives change events from asset-db and calls
`.build()` incrementally.

## ModLo (@cocos/creator-programming-mod-lo)

```ts
new ModLo({
  transformer?: 'babel' | 'swc',
  targets?: string | string[] | Record<string,string>,
  loose?: boolean,
  useDefineForClassFields?: boolean,
  guessCommonJsExports?: boolean,
  _importMetaURLValid?: boolean,
  cr?: CircularReferenceReportOptions,
  _compressUUID: (uuid: string) => string,     // required
  transformExcludes?: (string | RegExp)[],
  logger?: Logger,
  _helperModule?: string,
  checkObsolete?: boolean,
  hot?: boolean,
  importRestrictions?: { importerPatterns: string[]; banSourcePatterns: string[] }[],
  preserveSymlinks?: boolean,
})

.load(url: URL): Mod
.resolve(specifier: string, from?: URL, fromType?: ModuleType): ResolveResult
.setExternals(externals: string[]): void       // e.g. ['cc']
.addMemoryModule(url, source): MemoryModule    // for injected virtual modules
.setUUID(url, uuid): void                       // link asset URLs → UUIDs
.setImportMap(importMap, url): void             // support import maps
.setLoadMappings(record): void                  // URL-scheme → filesystem dir
.setAssetPrefixes(prefixes: string[]): void     // e.g. ['db://assets/']
.setExtraExportsConditions(conds: string[]): void
```

Notes:

- Every `db://` URL should be registered via `setLoadMappings(db:// →
  project/assets/)`.
- Every asset with a UUID needs `setUUID(url, uuid)`.
- `_compressUUID` is REQUIRED — Cocos uses their own scheme
  (`Editor.Utils.UuidUtils.compressUuid`). We can reimplement the same
  8-char base64-ish encoding.
- `setExternals(['cc'])` marks the engine as external (packer will emit
  `import 'cc'` unmodified; the SystemJS runtime resolves it via the
  engine bundle).

## Runtime consumers

- `@cocos/creator-programming-quick-pack/lib/loader.js` — SystemJS runtime
  loader used by the preview browser.
- `@cocos/creator-programming-quick-pack/lib/middleware.js` — HTTP
  middleware serving `.workspace` chunks + records. We already
  reimplemented parts of this in `preview-mirror.mjs` — could switch to
  using the real middleware once we own the packer.

## Output layout (already reverse-mapped from disk)

```
<workspace>/
  import-map.json                  (source-URL → chunk URL)
  main-record.json                 (module records + inspection)
  assembly-record.json             (per-assembly build state)
  resolution-detail-map.json       (resolution cache)
  chunks/
    <ab>/                          (2-char shard = first 2 chars of hash)
      <40-char-hex>.js             (SystemJS chunk)
      <40-char-hex>.js.map         (sourcemap)
```

Chunk filename is hash of source path (stable across content edits).

## Minimum mini-packer sketch

```js
import { ModLo } from '@cocos/creator-programming-mod-lo';
import { QuickPack } from '@cocos/creator-programming-quick-pack';
import { pathToFileURL } from 'url';

const projectDir  = 'd:/tempWorkspace/baseAIAutoCocos';
const assetsRoot  = `${projectDir}/assets`;
const workspace   = `${projectDir}/temp/programming/packer-driver/targets/preview`;
const origin      = 'project:/';

const modLo = new ModLo({
  transformer: 'babel',
  targets: 'chrome 100',
  loose: true,
  useDefineForClassFields: false,
  _compressUUID: compressUuid,          // impl below
  logger: myLogger,
});
modLo.setExternals(['cc']);
modLo.setLoadMappings({
  'db://assets/': pathToFileURL(assetsRoot).href + '/',
});
modLo.setAssetPrefixes(['db://assets/']);
// modLo.setUUID(...) per meta file

const packer = new QuickPack({ modLo, origin, workspace, sourceMaps: true });

const entries = await glob('assets/**/*.ts', { cwd: projectDir })
  .map((p) => `db://assets/${p.replace(/^assets\//,'')}`);

await packer.build(entries);
```

The heavy lifting is:

- Walking `.meta` files to build the URL → UUID map (feed `setUUID`).
- Registering the engine's `cc` shape (extern info map for typechecking
  can be omitted at build-time; runtime resolves).
- Managing incremental rebuilds vs first-time (probably just call
  `packer.build(...)` and let it use its internal caches).

## Estimate

Given fully-typed API + open source: **~1-2 days** to a first working
mini-packer that recompiles a single-scene project like `baseAIAutoCocos`
end-to-end.
