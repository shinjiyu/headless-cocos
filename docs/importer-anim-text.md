# .anim / .animgraph / TextAsset — headless 支持

覆盖真实 2D 项目盘点出的三个功能洞：AnimationClip、AnimationGraph、文本类配置资产。

## 1. `.anim`（cc.AnimationClip）— 纯 JSON sync 即可播放

**结论：不需要 CCON。**

- Creator 的 library 产物是 CCON `.bin`（把 track 数据编成二进制 buffer），
  但那只是**优化产物**，不是运行时的硬性契约。
- 源文件 `assets/**.anim` 本身就是标准序列化 JSON（`cc.AnimationClip` +
  `cc.animation.VectorTrack` / `RealCurve` 等），引擎的标准反序列化器直接吃。
- mirror 的 `SYNC_EXTS` 早已包含 `.anim`，直接把源 JSON 复制成
  `library/<uuid>.json`，浏览器 `loadAny({uuid})` → `cc.Animation.play()` 正常。

e2e 验证的不是"能加载"，而是**真的在动**：VectorTrack 驱动 `position.x`
0→200（1s 曲线），播放 500ms 后实测 x ≈ 96，符合线性插值预期。

## 2. `.animgraph`（cc.animation.AnimationGraph）— marionette 运行时开关

同 Spine 3.8/4.2 的故事：**引擎 bundle 里真身和空壳都在，import-map 决定用哪个**。

- 快照 bundle 同时注册了
  `marionette/runtime-exports.js`（真身）和 `marionette/index-empty.js`（空壳）。
- 项目引擎功能不含 `marionette` 时，import-map 有两条 redirect 指向空壳，
  浏览器报 `Can not find class 'cc.animation.AnimationGraph'`。
- mirror 的 `rewriteEngineImportMap` 现在会读
  `settings/v2/packages/engine.json` 的 `includeModules`（或 `MARIONETTE=1` env），
  含 `marionette` 就删掉这两条 redirect，真身生效，无需重 build 引擎：

  ```
  q-bundled:///fs/cocos/animation/marionette/runtime-exports.js            (删除 redirect)
  q-bundled:///fs/cocos/animation/marionette/pose-graph/runtime-exports.js (删除 redirect)
  ```

- `.animgraph` 源文件也是纯 JSON，已加进 `SYNC_EXTS` + 监听正则，
  改动即 sync 即 reload。

注意：真实项目（proj-l-client-mcjb）的 `includeModules` 本来就带
`marionette`，所以按项目设置自动开。

## 3. TextAsset（.txt / .csv / .yaml / .yml / .conf / .md）

新 importer：`spike/importers/text.cjs`

- library 产物一个文件：`library/<xx>/<uuid>.json`，
  `{ __type__: "cc.TextAsset", text: "<整个文件内容>" }`（与 Creator `text`
  importer 契约一致）。
- meta：`importer: "text"`, `files: [".json"]`；没有 meta 时自动生成 uuid。
- 用途：i18n 表、slot_config、symbol.conf 之类的配置文件。

## 代码位置

| 文件 | 变更 |
| --- | --- |
| `spike/importers/text.cjs` | 新增，TextAsset importer |
| `spike/preview-mirror.mjs` | `SYNC_EXTS` + `.animgraph`；text importer 接入 boot/watch；`isTracked` 加 txt/csv/yaml/conf/md/animgraph；`rewriteEngineImportMap` 加 marionette redirect 删除 |
| `spike/e2e-anim-text.cjs` | 新增 e2e |

## 验证

`node spike/e2e-anim-text.cjs`（需 mirror 运行在 :7460）：

1. 写 `move.anim`（position.x 0→200 VectorTrack）+ `notes.txt` + 最小 `ctrl.animgraph`
2. 等三个 library 产物出现
3. 浏览器内：TextAsset 内容逐字节相等；AnimationGraph 反序列化且 layers=1；
   AnimationClip 播放 500ms 后 x 从 0 涨到 ~96
4. 全套 10 个 e2e 回归全过（image/audio/font/bmfont+spine/spine-bin/spine42/prefab/plist/hmr/anim-text）
