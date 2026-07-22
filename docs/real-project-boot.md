# 真实项目（proj-l-client-mcjb）无头预览冒烟

把 mirror 指向真实 2D 项目跑通启动场景的过程中暴露并修复的缺口。

## 结果

- 引擎启动成功，`dev-entry` 场景完整渲染（UserID/Token/RoomID/TableID 表单 + 确认按钮）
- 60 FPS，draw call 15
- 失败请求：0
- 控制台只剩**项目自身**的警告：
  - 循环引用属性类型 `undefined`（AlertDialogUI / ConfirmDialogUI）—— Creator 预览同样会打
  - `URL 缺少必要參數: userId, token, …` —— 开发入口未带登录参数，属预期

运行方式（本机，不经 Docker）：

```powershell
$env:PACKER = "mini"
$env:PORT   = "7461"
$env:ENGINE_SNAPSHOT = "d:\tempWorkspace\headless-cocos-research\spike\engine-snapshot"
$env:PROJECT = "d:\UGit\proj-l-client-mcjb"
node d:\tempWorkspace\headless-cocos-research\spike\preview-mirror.mjs
# 浏览器打开 http://127.0.0.1:7461/
```

探测脚本：`spike/probe-real-project.cjs`（截图落在 `spike/probe-real-project.png`）。

## 本轮暴露并修复的三个缺口

### 1. settings.js 按项目重写（render pipeline）

缓存里的 `settings.js` 是从一个**自定义管线**项目快照的。真实项目用
`legacy-pipeline`，引擎启动时读到 `rendering.customPipeline: true` 但
`cclegacy.rendering` 未初始化 → `errorID 12109: custom-pipeline module not
available`，连场景都进不去。

`rewriteSettings` 现在从项目的 `settings/v2/packages/{engine,project}.json` 派生：

| 字段 | 来源 |
| --- | --- |
| `engine.engineModules` | `engine.json` → `includeModules` |
| `rendering.customPipeline` | `engine.json` → `render-pipeline._option` |
| `engine.macros` | `engine.json` → `macroConfig` |
| `screen.designResolution` | `project.json` → `general.designResolution` |
| `engine.customLayers` | `project.json` → `layer[]`（value → bit） |
| `assets.projectBundles` | 并入 `findBundles()` 发现的自定义 bundle |
| `launch.launchScene` | 首选 `assets/scene/PreviewBoot.scene`，否则第一个 `.scene` |

### 2. mini-packer 循环引用检测（CField is not a function）

真实项目大量协议定义类用装饰器（`@CField` / `@SerialClass`），模块之间
有循环依赖。Creator 预览通过 babel 插件 `plugin-detect-circular` 给每个
import 使用点加 `_crd` 守卫——未初始化时打印 warn，不崩。

mini-packer 之前没开这个插件，循环依赖直接变成 `TypeError: CField is not a
function`，场景脚本装不上。

改动：

- `spike/packer/plugin-cr.cjs`：功能等价的插件，但用
  `programPath.traverse`（Creator 原版用无 scope 的 standalone traverse，在
  我们的 babel 调用下会 `Couldn't find a Program`）。
- `spike/packer/build.cjs`：
  - 热替换 mod-lo 的插件导出为我们的实现
  - 注入 `cr` 选项（过滤 `cc` / `cc/env` / `db://`）
  - `addMemoryModule('cce:/internal/code-quality/cr.mjs', …)` 提供 reporter

### 3. localization-editor 预览端点

真实项目装了官方 localization-editor，预览时
`fetch('localization-editor/resource-list')` / `resource-bundle`。mirror 没有
这些路由时返回 404（不影响启动，但 l10n 不工作）。

现在从 `PROJECT/localization-editor/translate-data/*.yaml` 现算：

- `resource-list`：`{ defaultLanguage, fallbackLanguage, languages }`
  （默认语言取 `settings/.../localization-editor.json` 的 `localLanguage`）
- `resource-bundle`：`{ [lang]: { translation: {...}, asset: {...} } }`
  （`type === 1` 进 `asset` 命名空间，其余进 `translation`）

用最小 YAML 解析器，只吃 translate-data 那种 `items: - - key / - key:/value:/type:`
形状，不引入外部依赖。

## 还没验证的东西（下一步候选）

1. **登录进主游戏场景**：需要带 `userId/token/agentId/roomId/tableId` 参数，
   以及能连上后端。这是业务侧，不在无头预览本身。
2. **bundle.load 实战路径**：真实项目里 `resources` / `prefab` / `spine`
   三个自定义 bundle 的 config 已能合成（settings 里已登记），但还没在浏览器
   里实际点进加载链路。
3. **i18n 文本替换实战**：端点通了，但 UI 上的 i18n key 是否被正确替换成
   zh-Hant 值，需要进主场景后目视确认。
4. **Docker 跑真实项目**：镜像已同步 packer + mirror，还没把真实项目挂进
   容器做一遍（路径 / PROJECT_URL 哈希对齐）。
