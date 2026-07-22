# Poly Haven → headless import

Fetch CC0 models from [Poly Haven](https://polyhaven.com) and run them through
`importGltf` — the same pipeline assetsSrcAPI’s `PolyHavenProvider` feeds into
Cocos, without requiring Creator IDE.

## Why

Creator skips glTF cameras/lights; mesh/material/anim/skin/morph coverage is
already in `importers/gltf.cjs`. The remaining integration gap is **pulling
real online assets** for regression and demos. Poly Haven is CC0 and has a
stable HTTP API.

This module mirrors package selection from
[`@shinjiyu/assets-src-api` PolyHavenProvider](https://github.com/shinjiyu/assetsSrcAPI)
(`gltf` @ `1k`/`2k`/`4k` + `include` textures) but stays dependency-free.

## Usage

```powershell
# List small models
node .\spike\e2e-polyhaven.cjs --list

# Fetch + import (default: wooden_table_02 @ 1k)
node .\spike\e2e-polyhaven.cjs

# Another asset
$env:POLYHAVEN_ID='WetFloorSign_01'; node .\spike\e2e-polyhaven.cjs
```

Programmatic:

```js
const { fetchModelCached } = require('./importers/polyhaven.cjs');
const { importGltf } = require('./importers/gltf.cjs');

const pkg = await fetchModelCached('wooden_table_02', { resolution: '1k' });
const result = importGltf(pkg.entryGltf, libraryRoot);
```

Cache dir: `%TEMP%/headless-cocos-polyhaven/{id}/{resolution}/` (override with
`cacheDir` option).

## assetsSrcAPI

For full pool / ADL / CocosTargetAdapter workflows use the sibling repo:

`D:\workspace\assetsSrcAPI` — example `examples/polyhaven-cocos.adl.yaml`.

Headless-cocos only needs the download + `importGltf` path for importer CI.
