# PSD Artist Preview（Docker）

美术网页工作流：上传 PSD → **图层树预览编辑** → 转 Cocos → 预览 `web-mobile`。

设计文档：[`docs/design-psd-artist-preview-pipeline.md`](../../docs/design-psd-artist-preview-pipeline.md)

## 里程碑

| 阶段 | 状态 | 说明 |
|------|------|------|
| **M0** | ✅ | portal 上传 + job 落盘；可下载回 PSD |
| **M1** | ✅（降级） | Photopea 嵌入实验；主路径已让位于 M1.5 |
| **M1.5** | ✅ | 解析切图 + `/editor` 叠图预览；`scene-edit` 显隐/标 BG（**不回写 PSD**） |
| Loading H5 | ✅ | 单档 WebP/AVIF（统一长边，BG/原画同档）；缓存命中直接打开 |
| M2 | 待做 | 按 scene-edit 转 Cocos：BG→split→替换预烘焙产物 |
| M3 | 待做 | 进度/演示/清理测试 job |
| M4 | 可选 | 无头验图旁路；ASTC/WebP 开关 |

首版构建策略：**方案 A** — 预烘焙 `web-mobile` + 纹理热替换。

## 快速启动

```powershell
cd docker/artist-preview/portal
npm install
$env:JOBS_ROOT = (Resolve-Path ..\data\jobs).Path
$env:PUBLIC_BASE = "http://127.0.0.1:8800"
# 大文件可先限层数试跑： $env:PARSE_MAX_TILES = "80"
npm start
```

- 门户：http://127.0.0.1:8800/
- 编辑器：http://127.0.0.1:8800/editor/?job={id}
- 冒烟：`npm run smoke:m15`（需 portal 已监听）

Docker：

```powershell
cd docker/artist-preview
docker compose up --build
```

Key 解析顺序：`CURSOR_API_KEY` / `.env` → 本仓 `config.local.json` →  
`AIWS_CONFIG_LOCAL`（可选，见 `.env.example`；勿把 Key 写入仓库）。

无 Key 冒烟（确定性脚本，不跑 Agent）：

```powershell
$env:LOADING_PREVIEW_FALLBACK = "1"
docker compose up --build
```

- 门户：http://127.0.0.1:8810/
- Loading 预览：http://127.0.0.1:8810/preview/{id}/loading/
- static 服务：http://127.0.0.1:8801/preview/{id}/loading/
- 公网反代 / 手机扫码：设 `PUBLIC_BASE=https://your.domain/psd`，见 `deploy/onlyclaws/README.md`

## M1.5 行为

1. 上传 `.psd` → job `uploaded` → 后台 `parsing`
2. 写出 `exports/layers.json` + `exports/tiles/*.png`
3. 状态 `edit_ready` → 自动打开图层编辑器
4. 右侧节点树对齐 **aiws layout-tree**（扁平缩进 + twist + 拖拽改挂/调序）+ 可编辑 Inspector → `scene-edit.json`
5. `.psb`：暂返回 failed（后续接 psd-tools）

大 PSD（数百 MB）解析慢且吃内存；可用 `PARSE_MAX_TILES` 截断试跑。  
若要完整组 hidden，对已有 job **重新 parse**（新 `layers.json` 含 `groups[]`）。

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/jobs` | 上传；自动入队解析 |
| `GET` | `/api/jobs` | 列表 |
| `GET` | `/api/jobs/:id` | 状态（含 `editorUrl`） |
| `POST` | `/api/jobs/:id/parse` | 重新解析 |
| `GET` | `/api/jobs/:id/exports/*` | layers.json / tiles |
| `GET/PUT` | `/api/jobs/:id/scene-edit` | 编辑态（不写 PSD） |
| `GET` | `/api/jobs/:id/psd` | 原件下载 |
| `GET` | `/editor/?job=` | 图层预览编辑页 |
| `POST` | `/api/jobs/:id/convert` | M2 stub → 501 |
| `POST` | `/api/jobs/:id/loading-preview` | 排队 Cursor CLI 生成 Loading H5 |
| `GET` | `/api/jobs/:id/loading-preview` | 状态 / `previewUrl` |
| `GET` | `/preview/:id/loading/` | 纯 H5 Splash |

## Loading 页预览（Cursor in Docker）

对齐 AIWS：网页按钮 → 单飞队列 → 容器内 `agent -p --force --trust` → 产物静态 URL。

1. Skill：`.cursor/skills/loading-h5-preview/`
2. Agent cwd = `data/jobs/{id}/`，优先执行 `node /app/scripts/build-loading-h5.mjs --job-dir .`
3. 产出 `loading-h5/`；状态写 `loading-preview.json`
4. **不引入 Cocos 引擎**；结构模拟 poke-splash

## Job 盘

```
data/jobs/{jobId}/
  source.psd
  meta.json
  scene-edit.json
  exports/
  loading-h5/           # Loading Splash
  loading-preview.json
  logs/
  web-mobile/           # M2
```
