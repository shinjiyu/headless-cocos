# Pinned runtime kit (no Creator)

End users **do not install Cocos Creator**. Preview uses a version-pinned
kit: engine `cc` + mini-packer `@cocos/creator-programming-*`.

Current pin: **3.8.8**.

```
runtime/3.8.8/
  manifest.json
  engine/            # preview + native-external + internal-library
  node_modules/      # traced packer tree (~21 MB, not the full asar)
  utils/dist/uuid.js
```

`preview-mirror` and `spike/packer/build.cjs` resolve this folder first.
They no longer fall back to a local Creator install.

## New user

1. Clone [headless-cocos](https://github.com/shinjiyu/headless-cocos)
2. Get `headless-runtime-3.8.8.zip` from the team (or `HEADLESS_RUNTIME_URL`)
3. Unzip into `runtime/3.8.8/` — or `node spike/fetch-runtime.mjs`
4. `npm install`
5. `node spike/bootstrap.mjs --out D:\tempWorkspace\my-game`

Creator is not in this list. Wrong IDE versions cannot leak in; the kit is the version.

## Maintainer (rebake)

Only machines that already have a bake (this repo’s `docker/build-context`
or `spike/engine-snapshot` + vendor) regenerate the kit:

```powershell
node spike/bake-runtime.mjs --zip
# → runtime/3.8.8/  and  dist/headless-runtime-3.8.8.zip
```

Do not commit the binaries (Cocos license). Host the zip internally.
