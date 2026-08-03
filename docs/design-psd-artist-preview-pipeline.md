# 设计文档：PSD → 美术网页预览（一条龙）

**版本**：v0.3  
**日期**：2026-07-31  
**状态**：M0/M1/M1.5 已落地；下一阶段 **M2 转 Cocos**  

---

## 1. 目标与非目标

### 1.1 目标

给美术一条 **网页工作流**：

1. 打开门户页，上传 **PSD / PSB**
2. 服务端解析切图，进入 **自研图层预览界**（树 + 画布）
3. 在网页上 **调整节点 / 图层树**（显隐、层级、命名、选 BG 等）
4. 确认后 **转 Cocos / 转 H5**，触发工作流，产出 **构建产物**（`web-mobile`）
5. 在网页打开构建预览

**硬约束（v0.3）**

| 项 | 约定 |
|----|------|
| 网页上的树/节点修改 | **只写入作业侧编辑态**（见 §6），**绝不回写 PSD** |
| 转 Cocos 输入 | `source.psd`（只读原件）+ `scene-edit.json`（用户改动） |
| 预览主界面 | **自研 H5 图层壳**（复用 amadues `layers.json` + tiles 思路），**不默认嵌 Photopea** |

首版内容策略：

| 层 | 策略 |
|----|------|
| 背景 | **真十字拼（BgPlus）** — 由用户在树里点名 / 规则选出的 BG 图层 → 分割 → 进包 |
| UI | **假 UI** — 模板占位；树里可先整理，首版可不全部进 Cocos |

全部服务跑在 **Docker**；Cocos 侧复用 **无头 Cocos**。

### 1.2 非目标（首版不做）

- 把网页编辑结果写回 `.psd` / `.psb`
- 完整 Photopea 级像素编辑（涂抹、滤镜等）
- 完整 psd2cocos 全图层 UI 进场景（可后期接）
- 生产买量包 / 多租户 / Linux 内完整 Creator builder

---

## 2. 用户流程（更新）

```
上传 PSD
   │
   ▼
解析导出 layers.json + tiles/     ← source.psd 只读落盘，永不被改
   │
   ▼
【预览编辑界】树 + 叠图画布
   · 显隐 / 重排 / 重命名 / 标记 BG / 折叠组
   · 改动 → 自动/手动保存 scene-edit.json
   │
   ▼
「转 Cocos / 转 H5」
   │
   ▼
Orchestrator：读 source.psd + scene-edit.json
   → BgPlus / 装配 → web-mobile → /preview/:id
```

**页面阶段**

| 阶段 | 用户看到 | 后端 |
|------|----------|------|
| A 上传 | 选完自动上传 | `POST /api/jobs` → 落盘 `source.psd` |
| B 解析 | 进度 | 导出 `exports/layers.json` + `tiles/` |
| C **编辑** | 树 + 画布；调节点 | `GET/PUT scene-edit`；**不写 PSD** |
| D 转 Cocos | 进度 / 日志 | 入队：按 edit 选 BG → split → 装配 |
| E 产物预览 | `/preview/:id/` | 静态 `web-mobile` |

---

## 3. 系统架构（Docker Compose）

| 服务 | 职责 | 端口（示意） |
|------|------|--------------|
| `portal` | 上传、作业列表、**图层预览编辑壳**、转 Cocos、进度 | 8800 |
| `orchestrator` | 作业状态机 | 内部 |
| `psd-worker` | 读 PSD/PSB、导出 layers + tiles + 可选合成图 | 内部 |
| `asset-pipeline` | BgPlus split、替换模板产物 | 内部 |
| `cocos-headless` | 旁路验图（可选） | 7460 |
| `static` | 托管 `web-mobile` | 8801 / `/preview/` |

**卷（每 job）**

```
jobs/{id}/
  source.psd          # 原始上传，只读
  meta.json
  exports/
    layers.json       # 解析快照（结构源）
    tiles/            # 图层 PNG
  scene-edit.json     # ★ 用户树/节点改动（唯一可写编辑态）
  bg-plus/
  web-mobile/
  logs/
```

Photopea：**可选外链**（新窗口），不占主布局。

---

## 4. 关键决策：构建产物

仍采用 **方案 A：预烘焙 web-mobile + 纹理热替换**（详见历史 v0.2）。  
无头 Cocos 作旁路；主交付为静态包。

转 Cocos 时 **BG 来源** 优先读 `scene-edit.json` 里标记的背景节点；未标记则回退图层名约定 / 最大图层规则。

---

## 5. Cocos 工作流（与编辑态衔接）

| 步骤 | 动作 |
|------|------|
| 1 | 校验 `source.psd` 存在；加载 `scene-edit.json`（可为空 = 用解析默认树） |
| 2 | 按 edit 选出的 BG → 导出整图 / 对应 tile |
| 3 | `split-bg-plus` → 写产物 native |
| 4 | 假 UI 来自模板；（后期）可按 edit 树生成更多节点 |
| 5 | 发布 `/preview/:id/` |

---

## 6. 预览编辑界（替代默认 Photopea）

### 6.1 能力（首版）

| 操作 | 是否支持 | 落盘 |
|------|----------|------|
| 节点树 + Inspector 分栏（PSD 路径树 / 可编辑属性） | ✅ | `scene-edit` |
| 图层树展示（组/叶，组眼与子眼独立） | ✅ | `scene-edit.groups` |
| 显隐切换（有效可见 = 自身 ∧ 祖先） | ✅ | `scene-edit` |
| 拖拽调整兄弟顺序 | ⏳ 下轮 | `scene-edit` |
| 重命名显示名 | ✅ | `scene-edit`（不影响 PSD） |
| 位置 / 透明度 / 混合 | ✅ | `scene-edit` |
| 标记「用作 BgPlus 背景」 | ✅ | `scene-edit.bgLayerId` |
| 删除节点（仅编辑态隐藏/剔除） | ✅ 软删 | `scene-edit` |
| 像素级涂改 / 写回 PSD | ❌ | — |

实现基线：复用 `amadues-publish` / `psdanalysis-work` 的 **h5-preview-shell + layers.json**。  
右侧为 **节点树（上）+ Inspector（下）**：树按 PSD `path` 建组；Inspector 可编辑显示名/显隐/XY/透明度/混合/BG。  
`layers.json` 含 `groups[]`（path + hidden）与叶子 `effectiveHidden`。

### 6.2 `scene-edit.json` 草图

```json
{
  "version": 1,
  "updatedAt": "ISO-8601",
  "bgLayerId": "tile_00012",
  "nodes": {
    "tile_00012": {
      "visible": true,
      "name": "BG",
      "order": 0,
      "left": 0,
      "top": 0,
      "opacity": 1,
      "blendMode": "normal"
    },
    "tile_00003": { "visible": false, "name": "旧按钮", "order": 2 }
  },
  "groups": {
    "横版": { "visible": true }
  },
  "layoutTree": {
    "type": "root",
    "children": []
  },
  "treeOrder": ["group_ui", "tile_00012"],
  "removedIds": []
}
```

节点树 UI 对齐 **aiws** `layout-tree`：扁平行 + `padding-left: 8+depth*14` 缩进、twist 折叠、pointer 拖拽（上下边调序 / 中间改挂）。结构写入 `scene-edit.layoutTree`。

合并规则：画布渲染 = `layers.json` 结构 ⊕ `scene-edit` 覆盖。  
**转 Cocos 只读这份合并结果 + 原 PSD 像素（tiles / 按需再导出），不打开 PSD 写通道。**

### 6.3 Photopea 定位（降级）

- 默认 **不嵌入**
- 可选：「用 Photopea 打开」→ 新标签；仅辅助看稿
- Photopea 内任何修改 **不进入** 转 Cocos 管线

---

## 7. API 草图（更新）

```
POST   /api/jobs                      上传 PSD
GET    /api/jobs/:id
GET    /api/jobs/:id/psd              下载原件（只读）
GET    /api/jobs/:id/exports/layers.json
GET    /api/jobs/:id/exports/tiles/:name
GET    /api/jobs/:id/scene-edit
PUT    /api/jobs/:id/scene-edit       保存树/节点调整（不写 PSD）
POST   /api/jobs/:id/parse            触发/重跑解析（若上传后异步）
POST   /api/jobs/:id/convert          转 Cocos（读 edit + 原 PSD）
POST   /api/jobs/:id/loading-preview  排队 Cursor CLI → Loading H5
GET    /api/jobs/:id/loading-preview  状态 / previewUrl
GET    /api/jobs/:id/logs
GET    /preview/:id/                  web-mobile（M2）
GET    /preview/:id/loading/          纯 H5 Splash（无 Cocos）
GET    /editor/:id/                   图层预览编辑页（可同域 SPA）
```

**状态机**

`uploaded` → `parsing` → `edit_ready` → `queued` → `splitting` → `assembling` → `ready` | `failed`

Loading 预览旁路：`edit_ready` →（按钮）`loading_preview` → `loading_preview_ready`（不阻塞 M2）

---

## 7.1 Loading H5 + Cursor CLI（Docker）

| 项 | 约定 |
|----|------|
| 触发 | 门户 / 编辑器「Loading 页预览」 |
| 执行 | portal 容器内 Cursor Agent CLI（`CURSOR_API_KEY`） |
| Skill | 仓库 `docker/artist-preview/.cursor/skills/loading-h5-preview/` |
| 产出 | `jobs/{id}/loading-h5/` |
| 预览 | `/preview/{id}/loading/` |
| 降级 | `LOADING_PREVIEW_FALLBACK=1` 时确定性 `build-loading-h5.mjs` |

对齐 AIWS：单飞队列、服务端生成 previewUrl、不依赖 Creator 端口。

---

## 8. 目录与仓库边界

| 组件 | 归属 |
|------|------|
| portal / compose / jobs 数据 | `docker/artist-preview/` |
| 图层预览壳 | 迁入 `portal/public/editor/` 或从 amadues h5-preview 抽公共包 |
| BgPlus / 模板产物 | `baseAIAutoCocos` |
| 无头镜像 | `cocos-headless-preview` |

---

## 9. 里程碑（调整）

| 阶段 | 交付 | 状态 |
|------|------|------|
| M0 | 上传 + job 落盘 | ✅ |
| M1 | Photopea 嵌入（实验） | ✅ 完成；**主路径将让位于 M1.5** |
| **M1.5** | **解析 → 图层树预览编辑 + scene-edit 落盘（不写回 PSD）** | ✅ `docker/artist-preview` |
| **Loading H5** | 按钮 → Docker Cursor CLI → 纯 H5 Splash | ✅ |
| M2 | 按 scene-edit 转 Cocos / BgPlus 产物 | 待 M1.5 |
| M3 | 进度/演示/清理测试 job | |
| M4 | 无头旁路、压缩开关 | 可选 |

---

## 10. 风险与开放问题

1. 大 PSB（~700MB+）解析/切全层是否要「只导出可见层 / 合成图 + 结构」以免爆盘？  
2. 首版树编辑是否只服务 **选 BG + 显隐**，重排进 Cocos 放到后期？  
3. 假 UI 与树里真实 UI 图层如何并存展示（灰显「不进包」）？  
4. 并发与 ASTC 队列限流。

---

## 11. 相关现有资产

- 无头 Cocos：`docs/docker.md`
- BgPlus：`baseAIAutoCocos/docs/bg-plus-split.md`
- 图层 H5：`amadues-publish/docs/PSD_TO_H5.md`、`scripts/h5-preview-shell/`
- 本实现：`docker/artist-preview/README.md`

---

## 12. 确认清单

- [x] 构建产物 = 方案 A（预烘焙 + 纹理替换）  
- [x] 文档落点 = `docker/artist-preview/`  
- [x] **网页可调节点/树；改完再转 Cocos**  
- [x] **修改只进 `scene-edit.json`，不写回 PSD**  
- [x] **主预览 = 自研图层壳；Photopea 可选外链**  
- [ ] M1.5 首版编辑范围：仅「选 BG + 显隐」还是含「拖拽重排/重命名」（待你拍板）  
