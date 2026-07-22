# Asset Bundle（loadBundle）— headless 支持

真实项目大量使用自定义 bundle（`resources`、`spine_res`、`prefab` 等），
`assetManager.loadBundle('name')` + `bundle.load('dir/name')` 是主要的资源
获取方式。mirror 现在动态合成 bundle config，与构建产物同语义。

## 引擎侧契约（从 engine bundle 的 downloadBundle 读出）

```
loadBundle('<name>')
  → GET assets/<name>/config.json      (bundleVers 为空时不带版本号)
  → GET assets/<name>/index.js         (bundle 脚本入口，可为空壳)
  → config.base = "assets/<name>/"
```

之后 bundle 内资源加载走
`assets/<name>/import/xx/<uuid>.json` 与 `assets/<name>/native/...`，
mirror 原有的 library 路由已经接受任意 bundle 段，无需改动。

`config.paths` 的语义（Config.\_initPath）：
`uuid → [path, typeName, isSubAsset?]`；`bundle.load(path)` 是精确匹配，
所以 path 必须与用户代码传的一致——即**相对 bundle 根目录、无扩展名**，
与构建产物一致。子资产（texture/spriteFrame）带第三个元素。

## mirror 实现

1. **发现 bundle**：`findBundles()` 扫描 `assets/` 下所有目录 `.meta`，
   `userData.isBundle === true` 即 bundle，名字取 `userData.bundleName ||
   目录名`。bundle 可嵌套在任意深度（如 `asset_bundles/game_art/ab/prefab`）。
2. **合成 config.json**：`buildBundleConfig(name, root)` 以 bundle 目录为根
   跑一遍资产收集（复用 `collectHeadlessAssets`，现已支持传入根目录），输出：
   - 图片（ImageAsset/Texture2D/SpriteFrame，子资产路径 `xxx/texture`、
     `xxx/spriteFrame`）、音频、TTF、BMFont、Spine、plist（粒子/图集）、
     TextAsset
   - 纯 JSON 资产：prefab/scene/anim/animgraph/mtl/json →
     `cc.Prefab / cc.SceneAsset / cc.AnimationClip / cc.animation.AnimationGraph /
     cc.Material / cc.JsonAsset`
   - scene 同时登记进 `scenes`（`bundle.loadScene` 可用）
3. **合成 index.js**：空壳 `virtual:///prerequisite-imports/<name>` System 模块
   （bundle 内 TS 脚本本来就走 mini-packer 的全项目编译，不需要按 bundle 拆）。
4. 路由优先级：cache（main/internal 快照）> 动态合成。config 每次请求现算，
   所以 bundle 内增删资产后 reload 即生效，无缓存失效问题。

## 代码位置

| 文件 | 变更 |
| --- | --- |
| `spike/preview-mirror.mjs` | `findBundles` / `buildBundleConfig` / `BUNDLE_INDEX_JS`；`collectHeadlessAssets(rootDir)` 参数化并新增 texts/jsonAssets 收集；`mapPath` bundle 路由 + `sendMapped` 两个新 rewrite |
| `spike/e2e-bundle.cjs` | 新增 e2e |

## 验证（e2e-bundle.cjs）

1. 造 `assets/testbundle/`（meta 带 `isBundle`），内含 `hero.prefab` +
   `icon.png` + `notes.txt`
2. 浏览器 `loadBundle('testbundle')` → 观测到 config.json/index.js 200
3. `bundle.load('hero', Prefab)` → instantiate，Label 文本正确
4. `bundle.load('icon/spriteFrame', SpriteFrame)` → 24×24
5. `bundle.load('notes', TextAsset)` → 内容一致
6. `bundle.getDirWithPath('')` → 5 条资产信息（目录查询语义正常）
7. 全套 11 个 e2e 回归 PASS
