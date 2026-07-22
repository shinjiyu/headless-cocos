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

## Mirror HTTP API

With `preview-mirror` running (`PACKER=mini`):

```text
GET  /__polyhaven/list?maxPoly=1000&limit=20
GET  /__polyhaven?id=wooden_table_02&res=1k
GET  /__polyhaven?id=wooden_table_02&res=1k&spawn=1
POST /__polyhaven?id=wooden_table_02&res=1k&spawn=1
GET  /__spawn?uuid=<prefabUuid>&name=wooden_table_02
GET  /__spawn-pending
```

`spawn=1` queues the imported scene prefab, triggers HMR reload, then the
injected boot script (`index.html`) `loadAny` + `instantiate`s it into the
live scene as a child named after the asset id. `/__spawn` does the same for
any existing prefab uuid (`reload=1` to force a full page reload first).

Fetches into `assets/polyhaven/{id}/`, runs `importGltf`, then broadcasts HMR reload.
JSON response includes `uuid`, mesh/material sub-ids, optional `spawn`, and the Poly Haven source URL.

## assetsSrcAPI

For full pool / ADL / CocosTargetAdapter workflows use the sibling repo:

`D:\workspace\assetsSrcAPI` — example `examples/polyhaven-cocos.adl.yaml`.

Headless-cocos only needs the download + `importGltf` path for importer CI.
