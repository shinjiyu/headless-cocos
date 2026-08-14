# Headless Cocos — Cursor / Agent 搭建

把 **本文件的 URL** 发给 Cursor（或任何 Agent）。按顺序执行，不要问用户装 Cocos Creator，不要开 IDE。

当前钉死版本：**Creator 引擎 3.8.8**（来自运行时包，不是本机安装）。

- 仓库：https://github.com/shinjiyu/headless-cocos
- 工程模板：https://github.com/shinjiyu/baseAIAutoCocos/tree/headless
- 本 playbook（raw，推荐丢给 Agent）：
  https://raw.githubusercontent.com/shinjiyu/headless-cocos/feat/artist-preview-design/AGENT_SETUP.md

## 目标

本机出现：

1. `headless-cocos` 预览栈
2. 一份 `runtime/3.8.8/` 运行时包（引擎 + packer）
3. 一个可改的 Cocos 工程（`base-ai` 壳：ViewWeaver，无 MCP）
4. 浏览器预览 `http://127.0.0.1:7460/`，改 `assets/` 会 HMR

## 禁止

- 安装 / 启动 Cocos Creator
- 调用 `cocosmcp` / MCP / `Editor.Message`
- 用官方 Empty 模板（没有 `assets/`，无头起不来）
- 用 PA 的 MainUI / CTA / 盘面当默认工程

## 0. 前提

- Node.js ≥ 20（没有就提示用户装 Node，**不是** Creator）
- 工作目录自定；Windows 默认用 `D:\tempWorkspace`

```powershell
node -v
```

## 1. 克隆预览栈

若当前工作区已经是 `headless-cocos`（有 `spike/preview-mirror.mjs`），跳过 clone，在该根目录做后面的步骤。

```powershell
git clone https://github.com/shinjiyu/headless-cocos.git
cd headless-cocos
git checkout feat/artist-preview-design
npm install
```

本机 git 若被拦截，用 `hutao` 代替所有 `git` 命令。

## 2. 准备 3.8.8 运行时包（不装 Creator）

检查是否已就绪：

```powershell
node -e "console.log(JSON.stringify(require('./spike/runtime-kit.cjs').kitStatus(),null,2))"
```

`ready: true` → 跳到第 3 步。

否则按顺序试，**成功一个就停**：

1. 用户给了 zip 路径或 `HEADLESS_RUNTIME_URL`  
   ```powershell
   node spike/fetch-runtime.mjs
   ```
   或把 zip 解压到 `runtime/3.8.8/`（里面要有 `engine/preview` 和 `node_modules/@cocos/creator-programming-quick-pack`）。
2. 本机已有烤好的产物（`docker/build-context/engine` + `vendor`，或 `spike/engine-snapshot`）  
   ```powershell
   node spike/bake-runtime.mjs
   ```
3. 都没有 → **不要装 Creator**。照样执行第 3 步建工程，然后明确告诉用户：预览缺 `headless-runtime-3.8.8.zip`，放到 `runtime/3.8.8/` 后再开 preview。停在这里等用户给包。

## 3. 用模板建工程

```powershell
node spike/bootstrap.mjs --out D:\tempWorkspace\my-game
```

`bootstrap` 会从 `templates/base-ai-headless` 拷一份（同源 [baseAIAutoCocos `headless`](https://github.com/shinjiyu/baseAIAutoCocos/tree/headless)）。  
若第 2 步 kit 未就绪，`bootstrap` 会失败；改用：

```powershell
node spike/create-project.mjs --template base-ai --out D:\tempWorkspace\my-game
```

工程里改 prefab / scene **直接改 JSON 文件**，不要找节点树 API。

## 4. 启动预览

仅当 `kitStatus().ready === true`：

```powershell
$env:PACKER = "mini"
$env:PORT = "7460"
$env:PROJECT = "D:\tempWorkspace\my-game"
node spike/preview-mirror.mjs
```

后台跑。日志必须有：

- `ENGINE_SNAPSHOT=...`（指向 kit / snapshot，**不是** `C:\ProgramData\cocos\...`）
- `[mini] build#1 ok` 或同等成功
- `http://127.0.0.1:7460`

浏览器打开 http://127.0.0.1:7460/ （不要带 `autoReload=false`，否则收不到 HMR）。

## 5. 告诉用户怎么接着干

- 改 `D:\tempWorkspace\my-game\assets\` → 自动补 `.meta`、打包、热更
- ViewWeaver：`POST http://127.0.0.1:7460/__viewweaver`  
  或 `node spike/viewweaver-host.mjs --project D:\tempWorkspace\my-game <Prefab名>`
- 不要开 Creator，不要 MCP

## 失败对照

| 现象 | 处理 |
|------|------|
| `ready: false` / `missing pinned 3.8.8 runtime` | 第 2 步拿 zip 或 bake，禁止装 Creator |
| `unknown template: base-ai` | 不在 `feat/artist-preview-design`，先 checkout |
| 端口占用 | 换 `PORT` 或杀掉旧 `preview-mirror` |
| 本机 `git push` 异常 | 全部改用 `hutao` |
