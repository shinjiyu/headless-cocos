# Headless Cocos — Agent 改工程知识

搭建用 [AGENT_SETUP.md](https://raw.githubusercontent.com/shinjiyu/headless-cocos/feat/artist-preview-design/AGENT_SETUP.md)。  
**本文件**：环境已经起来之后，怎么改 prefab / scene / 资源，以及何时必须跑 ViewWeaver。

把本 URL 发给 Cursor：

https://raw.githubusercontent.com/shinjiyu/headless-cocos/feat/artist-preview-design/AGENT_AUTHORING.md

工程 = 当前 Cocos 工程根（环境变量 `PROJECT` / SETUP 算出的 `GAME`）。  
预览 = SETUP 实际打出来的 `http://127.0.0.1:<PORT>/`。CLI 在预览栈根（`STACK`）下跑。

## 总原则

1. **磁盘是唯一真相。** 改 `assets/` 下的文件。无头栈 watch → 补 `.meta` → 导入 `library/` → 打包 → HMR。
2. **不要 Creator / MCP。** 禁止 `cocosmcp`、`Editor.Message`、装/开 IDE、`creator-preview-refresh`。
3. **业务 UI 必须走 ViewWeaver。** 代码要 `view.xxx` 点名操作的节点，先写进 bind，再生成。不要手写一套平行绑定。
4. **现有 `.meta` uuid 永不改。** prefab / scene 靠 uuid 引用图和脚本。没有 meta 时让栈 mint，不要自己 invent 再覆盖已有的。

## 目录约定（`base-ai` 壳）

默认 **base-ai** 是 2D 壳。3D 工程用 SETUP 的 `--template base-ai-3d`（透视相机 + 灯 + 示例 Cube）。

| 路径 | 用途 |
|------|------|
| `assets/scene/PreviewBoot.scene` | 启动场景（2D：Canvas + Camera；3D：Main Camera + Main Light + Cube） |
| `assets/prefabs/` | 业务 Prefab |
| `assets/resources/` | 可 `resources.load` 的 bundle（已标 `isBundle`） |
| `assets/scripts/views/<Name>/` | ViewWeaver 产出（本工程是 viewweaver，不是 `_genbot`） |
| `extensions/viewweaver/` | 只用**本工程**这份 CLI，禁止拿别的仓库的 ViewWeaver 顶替 |

每个 View 目录：

- `<Name>.bind.json` — 导出契约，进 git，可手改
- `<Name>.gen.ts` — 生成物，**禁止手改**
- `<Name>.view.ts` — 业务类，仅首次生成，之后手维护

## 加资源（图 / 音 / 字 / Spine / JSON…）

1. 把文件放进 `assets/`（需要 `resources.load` 的放 `assets/resources/`）。
2. **不要**手写 `.meta`（除非你在复用一个已有 uuid）。没有 meta 时预览会 mint；已有合法 uuid 不会被转。
3. 等 HMR。图片会出 `SpriteFrame`（子资源 `@f9941`）。
4. prefab / scene 里引用精灵：写

```json
"_spriteFrame": {
  "__uuid__": "<image-meta-uuid>@f9941",
  "__expectedType__": "cc.SpriteFrame"
}
```

`<image-meta-uuid>` 来自该图的 `.meta` 的 `uuid` 字段。

常见类型由栈导入：png/jpg、音频、ttf、bmfont、Spine 3.8/4.2、plist、gltf/glb、纯 JSON→`JsonAsset`。prefab/scene/anim 是 JSON 同步进 `library/`。

## 改 Prefab / Scene

文件就是 JSON 数组。`__id__` 是**数组下标**，增删对象后必须重映射所有 `{ "__id__": n }`，否则树会断。

可以做：

- 改已有节点的 `_lpos` / `_lscale` / `_euler`、`cc.UITransform` 的 `_contentSize`
- 换 `_spriteFrame` uuid（见上）
- 改 `_name`（若该节点已在 bind 里，改完必须跑 ViewWeaver）
- 在数组末尾**追加**新节点 + 组件，并把新 `__id__` 挂到父节点 `_children`

不要做：

- 为了「更干净」重排整份 JSON 却忘了 remap `__id__`
- 改任何 `.meta` 里已有的 `uuid`
- 手改 `*.gen.ts`
- 为官方 Empty / MCP `create-node` 找场景 API——无头没有。磁盘改文件就是正路

启动场景默认是 `PreviewBoot`。往场景里加常驻 UI：改 `PreviewBoot.scene`，或在脚本里 `resources.load` prefab 再实例化。

## 3D（`--template base-ai-3d`）

2D 壳没有灯、ambient 全黑、`engine.json` 关掉了 `3d`。不要在 2D 工程里硬塞 `MeshRenderer`——白盒子会渲成黑的。

3D 模板已经有：透视 `Main Camera`、`Main Light`、非黑 ambient、示例 `Cube`。再加网格时 **写死这些 UUID**，不要翻 `internal-library/`：

| 资源 | UUID |
|------|------|
| box mesh | `1263d74c-8167-4928-91a6-4e2672411f47@a804a` |
| sphere | `1263d74c-8167-4928-91a6-4e2672411f47@17020` |
| plane | `1263d74c-8167-4928-91a6-4e2672411f47@2e76e` |
| capsule | `1263d74c-8167-4928-91a6-4e2672411f47@801ec` |
| cone | `1263d74c-8167-4928-91a6-4e2672411f47@38fd2` |
| cylinder | `1263d74c-8167-4928-91a6-4e2672411f47@8abdc` |
| torus | `1263d74c-8167-4928-91a6-4e2672411f47@40ece` |
| quad | `1263d74c-8167-4928-91a6-4e2672411f47@fc873` |
| builtin-standard | `620b6bf3-0369-4560-837f-2a2c00b73c26` |

`a3cd009f-…` 是 **unlit EffectAsset**，不是 Material。栈没有 `.material` importer，不要自己造材质文件。要看得见：留着灯，或保持 ambient 非黑。`builtin-standard` 没光就是黑的。

子资源 URL 带后缀（`@a804a.json`），不要只请求 prefab 主 uuid。

追加节点示例（挂到 Scene `_children`，`_layer` 用 `1073741824`）：

```json
"_mesh": {
  "__uuid__": "1263d74c-8167-4928-91a6-4e2672411f47@a804a",
  "__expectedType__": "cc.Mesh"
},
"_materials": [
  {
    "__uuid__": "620b6bf3-0369-4560-837f-2a2c00b73c26",
    "__expectedType__": "cc.Material"
  }
]
```

要 UI 叠加：自己加 Canvas（`_layer` `33554432`），别删 Main Camera / Main Light。

## ViewWeaver（必须会）

### 做什么 / 不做什么

| 做 | 不做 |
|----|------|
| 按 **bind.json** 生成 `*.gen.ts`（`bind()` / `NODE_PATHS`） | 不会把 prefab 每个节点都导出 |
| 首次生成可手改的 `*.view.ts` | 不负责合图、布局拖拽 |
| 校验 bind 路径是否还在 prefab 上 | 只换图 / 只改 XY 不必生成也能显示 |

`HarStaging` / `har_*` 等布局临时节点 **默认不要进 bind**。只有业务代码要 typed 访问时才写入 bind。

### 何时必须跑

- 新增业务 Prefab，要出 View
- 把新业务节点加入 bind 之后
- 已在 bind 里的节点改名 / 改层级路径
- 用户说「跑 ViewWeaver / 重新绑定」

### 何时不要跑

- 只加贴图、只改 X/Y/Scale、只换 SpriteFrame uuid
- 只改 `*.view.ts` 逻辑
- 只动 `har_*` 摆位且不打算 `view.xxx` 访问

**禁止** `--regen-bind`（会按默认规则重写契约，可能把 `har_*` 扫进 bind），除非用户明确要重置契约。

### 怎么跑（无头，禁止 MCP）

预览已开：

```
GET  http://127.0.0.1:<PORT>/__viewweaver
POST http://127.0.0.1:<PORT>/__viewweaver
     { "prefab": "<Prefab名>" }
     { "prefab": "assets/prefabs/<Prefab名>.prefab" }
     { "all": true }
```

或 CLI（在 `STACK` 根）：

```powershell
node spike/viewweaver-host.mjs --project $GAME --status
node spike/viewweaver-host.mjs --project $GAME <Prefab名>
node spike/viewweaver-host.mjs --project $GAME --all
```

只用**该工程**的 `extensions/viewweaver`。有 `extensions/genbot` 的老工程产出在 `_genbot/`，不要用外带 ViewWeaver 把它迁到 `views/`。

注册 prefab 被改时，预览 watch 会自动 generate。Agent 改完 bind 或节点路径后，仍应主动 POST 一次，不要假设用户去点按钮。

新生成的 `.ts` 下一轮 packer 会补 meta，然后 HMR。

## 推荐操作顺序

**新做一个可点的 UI Prefab**

1. 在 `assets/prefabs/Foo.prefab` 写节点树（或从现有 prefab 复制再改）
2. 需要的图放进 `assets/`，prefab 里引用 `@f9941`
3. 等 meta mint（或看旁边是否已有 `.meta`）
4. `POST /__viewweaver` `{ "prefab": "Foo" }`
5. 业务写在 `assets/scripts/views/Foo/Foo.view.ts`，不要改 `.gen.ts`
6. 场景或入口脚本里 load / 挂上这个 View

**只改样子**

改 prefab/scene 的位置、尺寸、换图 uuid → 保存文件 → 等 HMR。不跑 ViewWeaver。

**代码要拿到新节点**

手改 `<Name>.bind.json` 加上 path → `POST /__viewweaver` → 在 `.view.ts` 里用生成的字段。

## 禁止清单（再强调）

- 装 / 开 Cocos Creator
- `cocosmcp_*` / `Editor.Message` / `generate-from-asset`（会弹窗）
- 手改 `*.gen.ts`
- 无必要 `--regen-bind`
- 轮转已有 uuid
- 用外部分支的 ViewWeaver CLI 覆盖本工程扩展
