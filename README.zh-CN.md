<div align="center">

# Headless Cocos

### Cocos Creator 3.8 无头预览栈 — 无需常开 IDE

[![GitHub stars](https://img.shields.io/github/stars/shinjiyu/headless-cocos?style=flat&logo=github)](https://github.com/shinjiyu/headless-cocos/stargazers)
[![License](https://img.shields.io/badge/license-Research-blue)](./README.zh-CN.md#许可)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![Cocos Creator](https://img.shields.io/badge/Cocos%20Creator-3.8.8-orange)](https://www.cocos.com/creator)
[![Docker](https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white)](./docs/docker.md)
[![Importers](https://img.shields.io/badge/importers-wipe%20tested-success)](./docs/importers.md)

编译 TypeScript · 导入资源 · 热更新预览 — **不必**一直挂着 Creator。

[English](./README.md)
·
[文档索引](./docs/README.md)
·
[架构](./docs/architecture.md)
·
[Docker](./docs/docker.md)
·
[GitHub](https://github.com/shinjiyu/headless-cocos)

</div>

---

## Notice — 这是什么

一套用 **Node.js** 替代 Creator IDE 运行时职责的预览服务，面向 AI Agent、CI、远程机器上的「改磁盘 → 看效果」循环。

已在 Creator **3.8.8**、Docker Desktop（Windows）、以及真实**试玩广告**工程上验证：清空 `library/` 后由本仓库 importer **全量重建**，预览画面与 IDE 基线一致。

```bash
git clone https://github.com/shinjiyu/headless-cocos.git
cd headless-cocos
# 完成引擎快照后 —— 见「快速开始」
PACKER=mini PORT=7460 PROJECT=/path/to/project \
  ENGINE_SNAPSHOT=$PWD/spike/engine-snapshot \
  node spike/preview-mirror.mjs
```

---

## 为什么需要它

Creator 迭代链路很重：Electron IDE → AssetDB → packer → 预览。对 Agent / CI 来说，IDE 本身就是瓶颈。

本仓库用纯 Node 服务替换 IDE 的运行时角色：

1. 提供与 Creator 预览等价的 HTTP / WebSocket 表面  
2. 用 **mini-packer**（`@cocos/creator-programming-*`）编译工程脚本  
3. 用无头 **importer** 把 `assets/` 导入 `library/`  
4. 文件变更时推送 HMR 刷新  

Creator 仍可用于编辑与一次性快照；日常预览迭代不必常开。

---

## 能力一览

| 领域 | 支持 |
|------|------|
| 脚本编译 | TS / JS → Creator 兼容 preview chunk |
| 热更新 | `fs.watch` + 可选轮询（Docker Desktop 挂载） |
| 图片 | PNG / JPG → `ImageAsset` + `Texture2D` + `SpriteFrame` |
| 音频 | MP3 / WAV / OGG / AAC / M4A → `AudioClip` |
| 字体 | TTF → `TTFFont`；BMFont → `BitmapFont` |
| Spine | 3.8 & 4.2，按工程设置选运行时 |
| 粒子 / 图集 | `.plist` → `ParticleAsset` 或 `SpriteAtlas` |
| glTF / GLB | 多 mesh 节点树 → `Mesh` + `Material` + prefab |
| FBX | 经 Creator `FBX2glTF` 转入同一管线 |
| 文本 | `.txt` / `.csv` / `.yaml` / … → `TextAsset` |
| 数据 JSON | 普通 JSON → `JsonAsset` |
| 动画 | `.anim` / `.animgraph` |
| Prefab / 场景 | JSON 同步进 `library/` |
| Bundle | 自动发现 `isBundle`，合成 `config.json` |
| 引擎内置资源 | `internal-library` 快照回退 |
| Docker | 镜像 + compose，工程 bind mount |

---

## 架构

```
编辑 assets/*  →  preview-mirror
                    ├─ importers → library/
                    ├─ mini-packer → preview-mini/
                    └─ HTTP + WS HMR → 浏览器
```

| `PACKER` | 行为 | 适用 |
|----------|------|------|
| `mini` | 自建 library + 重编脚本 | **无头 / 测 importer** |
| `creator` | 直接用 Creator 已有产物 | 与 IDE 保真对比 |

详见：[docs/architecture.md](./docs/architecture.md)

---

## 快速开始

### 环境

- Node.js **≥ 20**
- Cocos Creator **3.8.8**（仅用于打一次引擎快照）
- 同版本工程（含 `assets/`）
- 可选 Docker Desktop

### 克隆

```bash
git clone https://github.com/shinjiyu/headless-cocos.git
cd headless-cocos
```

### 一次性引擎快照

```powershell
npx @electron/asar extract `
  "C:\ProgramData\cocos\editors\Creator\3.8.8\resources\app.asar" `
  tmp-asar-root

node .\spike\snapshot-from-creator.cjs
```

完整说明：[Getting started](./docs/getting-started.md)

### 本地运行（mini）

```powershell
$env:PACKER = "mini"
$env:PORT = "7460"
$env:PROJECT = "D:\path\to\your-cocos-project"
$env:ENGINE_SNAPSHOT = "$PWD\spike\engine-snapshot"
$env:LAUNCH_SCENE = "Main"
node .\spike\preview-mirror.mjs
```

浏览器打开 **http://127.0.0.1:7460/**

### Docker

```powershell
cd docker
docker build -t cocos-headless-preview:latest .\build-context
docker compose up -d
```

Importer 删库压测：

```powershell
docker compose -f docker-compose.playable-mini.yml up -d
# → http://127.0.0.1:7463/
```

---

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `PROJECT` | — | 工程根目录 |
| `PORT` | `7460` | 监听端口 |
| `PACKER` | `creator` | `mini` \| `creator` |
| `ENGINE_SNAPSHOT` | — | 引擎快照目录 |
| `PROJECT_URL` | — | 原始 `file:///…`（chunk SHA1 / Docker） |
| `LAUNCH_SCENE` | 自动 | 场景 uuid / 名称 |
| `WATCH_POLL` | 关 | Docker Desktop 设 `1` |
| `SPINE_VERSION` | 读工程 | `3.8` \| `4.2` |

---

## 验证

```powershell
node .\spike\probe-real-project.cjs
node .\spike\e2e-hmr.cjs
node .\spike\e2e-image-import.cjs
```

**Importer 权威验收：** 复制工程 → 删掉 `library/` → `PACKER=mini` → 启动场景正常且 **失败请求 = 0**。

---

## 文档

| 文档 | 内容 |
|------|------|
| [English README](./README.md) | English overview |
| [Getting started](./docs/getting-started.md) | 快照、首启、排错 |
| [Architecture](./docs/architecture.md) | Mirror / packer / settings |
| [Importers](./docs/importers.md) | 资源导入契约 |
| [Docker](./docs/docker.md) | 镜像与 compose |
| [文档索引](./docs/README.md) | 全部文档入口 |

---

## 限制

- 仅 **Creator 3.8.x**（已验 3.8.8）
- `trimType: auto` 输出未裁剪矩形（无像素解码）
- 引擎快照 **不进 git**，需本机生成
- 暂不覆盖 3D 粒子

---

## 许可

研究 / 内部工具向。引擎二进制与 `@cocos/*` 仍受 **Cocos Creator 许可**约束，请勿擅自分发 vendor 树或引擎快照。

---

## 相关链接

- 示例工程：[shinjiyu/baseAIAutoCocos](https://github.com/shinjiyu/baseAIAutoCocos)
- 上游产品：[Cocos Creator](https://www.cocos.com/creator)
