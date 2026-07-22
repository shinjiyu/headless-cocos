# Packer landscape (2026-07-17)

## Big finding

Creator's user-script compile stack is **almost entirely plain JS**, only the
Editor lifecycle-glue `packer-driver.ccc` is binary. Reverse-engineering .ccc
is NOT required for true headless.

## Layers

| Layer | Package | Type | License | Where |
|-------|---------|------|---------|-------|
| Engine build | `@cocos/ccbuild@2.3.16` | plain JS | MIT | GitHub + npm |
| Engine compile wrapper | `@editor/quick-compiler@4.2.19` | plain JS | — | asar node_modules |
| User-script packer | `@cocos/creator-programming-quick-pack@1.7.2` | plain JS | ISC | **npm** |
| Packer deps | `@cocos/creator-programming-{common,mod-lo,import-maps}` | plain JS | — | asar node_modules |
| Programming glue | `@editor/lib-programming@3.8.1` | plain JS | MIT | asar node_modules |
| Editor lifecycle driver | `builtin/programming/dist/packer-driver/*.ccc` | binary | — | asar (only piece we can't read as source) |

## Implication

True headless packer = **thin re-implementation of packer-driver in plain
Node**, calling `quick-pack.build()` with the same arguments the .ccc driver
would have passed.

We can either:

1. `npm install @cocos/creator-programming-quick-pack` and write a driver
   from scratch.
2. Symlink / require the copies already inside the extracted asar and use
   the existing `node_modules` tree.

## To learn the exact call contract

Hook `Module.prototype.require` (or `Module._load`) inside Creator main
process to log every call to:

- `@cocos/creator-programming-quick-pack` (any export)
- `@editor/lib-programming` (any export)

Then trigger `asset-db refresh-asset` once. The log will show:
- The exact constructor / builder options
- Which methods are called in what order
- Return values / side effects

That's a mechanical exercise once we've confirmed there's no obfuscation
inside the .ccc that would change contracts.

## Note on chunk hashes

Verified via a real recompile: chunk filenames like
`chunks/7d/7d0661b2ee33e4b885a478dbc38c7441b8df4bbf.js` are hashed from
the **source path**, not content, so identical URL across edits. Cache
busting must use mtime / manifest, not URL query.

The 4 record files that DO change per compile:

- `import-map.json`  (source-path → chunk-URL)
- `main-record.json`
- `assembly-record.json`
- `resolution-detail-map.json`

All written via `*.tmp` → `rename` atomic pattern.
