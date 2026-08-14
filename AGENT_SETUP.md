# Headless Cocos — Cursor / Agent 搭建

**唯一入口。** 新环境只丢这一份 URL。按顺序做完：预览栈、3.8.8 运行时、工程、预览，以及改工程知识（ViewWeaver / prefab / 资源）都会进本机。不要再另找第二份入口才能开始。

不要问用户装 Cocos Creator，不要开 IDE。

当前钉死版本：**Creator 引擎 3.8.8**（来自运行时包，不是本机安装）。

- 仓库：https://github.com/shinjiyu/headless-cocos
- 工程模板：https://github.com/shinjiyu/baseAIAutoCocos/tree/headless
- 本入口（raw）：
  https://raw.githubusercontent.com/shinjiyu/headless-cocos/feat/artist-preview-design/AGENT_SETUP.md

## 目标

本机出现：

1. `headless-cocos` 预览栈
2. 一份 `runtime/3.8.8/` 运行时包（引擎 + packer）
3. 一个可改的 Cocos 工程（`base-ai` 壳：ViewWeaver，无 MCP）
4. 浏览器预览 `http://127.0.0.1:7460/`，改 `assets/` 会 HMR
5. 工程内已安装改工程知识：`AGENT_AUTHORING.md` + `.cursor/skills/headless-authoring/`

## 禁止

- 安装 / 启动 Cocos Creator
- 调用 `cocosmcp` / MCP / `Editor.Message`
- 用官方 Empty 模板（没有 `assets/`，无头起不来）
- 用 PA 的 MainUI / CTA / 盘面当默认工程

## 0. 前提

- Node.js ≥ 20（没有就提示用户装 Node，**不是** Creator）
- **ROOT = 用户当前工作区**（本对话打开的目录，或用户点名的路径）。  
  **禁止**擅自改用 `D:\tempWorkspace` / `my-game`，除非用户写了这两个字。
- 记三个路径，后面命令全部用变量，不要抄示例里的盘符：

| 变量 | 含义 | 算法 |
|------|------|------|
| `ROOT` | 用户工作区 | 当前 workspace；本例若用户在 `D:\workspace\nococos` 就用它 |
| `STACK` | 预览栈仓库 | `ROOT` 里已有 `spike/preview-mirror.mjs` → `STACK=ROOT`；否则 `STACK=ROOT\headless-cocos`（clone 到这里） |
| `GAME` | Cocos 工程 | 用户指定则用指定；否则 `GAME=ROOT\my-game`（在 **ROOT 下**，不在别的盘） |

```powershell
node -v
pwd   # 确认 ROOT，不要跳到 D:\tempWorkspace
```

## 1. 克隆预览栈

若当前工作区已经是 `headless-cocos`（有 `spike/preview-mirror.mjs`），跳过 clone，在该根目录做后面的步骤。

```powershell
# 在 ROOT 下执行。不要 cd 到 D:\tempWorkspace
git clone https://github.com/shinjiyu/headless-cocos.git "$STACK"
cd $STACK
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
cd $STACK
node spike/bootstrap.mjs --out $GAME
```

`bootstrap` 会从 `templates/base-ai-headless` 拷一份（同源 [baseAIAutoCocos `headless`](https://github.com/shinjiyu/baseAIAutoCocos/tree/headless)）。  
若第 2 步 kit 未就绪，`bootstrap` 会失败；改用：

```powershell
node spike/create-project.mjs --template base-ai --out $GAME
```

工程里改 prefab / scene **直接改 JSON 文件**，不要找节点树 API。

## 4. 启动预览

仅当 `kitStatus().ready === true`：

```powershell
cd $STACK
$env:PACKER = "mini"
$env:PORT = "7460"    # 被占用就 +1，并告诉用户实际端口
$env:PROJECT = $GAME  # 必须是上面建的工程，不是 STACK
node spike/preview-mirror.mjs
```

后台跑。日志必须有：

- `PROJECT=` 等于 `$GAME`
- `ENGINE_SNAPSHOT=...`（指向 kit / snapshot，**不是** `C:\ProgramData\cocos\...`）
- `[mini] build#1 ok` 或同等成功
- `http://127.0.0.1:<PORT>`

浏览器打开该地址（不要带 `autoReload=false`，否则收不到 HMR）。  
`7460` 若已被别的 Docker / 旧 preview 占用，换端口，不要去复用别人的 7460。

## 5. 安装并读改工程知识（不要停在「环境好了」）

`bootstrap` / `create-project` 已把知识拷进 **`$GAME`**：

- `$GAME\AGENT_AUTHORING.md`
- `$GAME\.cursor\skills\headless-authoring\SKILL.md`

**立刻 Read `$GAME\AGENT_AUTHORING.md`**，之后改 prefab / scene / 资源 / View 只跟这份走。不要靠 Creator MCP skill。

若拷贝缺失，从 `$STACK` 再拷一次：

```powershell
Copy-Item $STACK\AGENT_AUTHORING.md $GAME\AGENT_AUTHORING.md
```

向用户交代（用真实路径，不要写 tempWorkspace 示例）：

- 唯一入口已经跑完；以后打开的是 `$GAME`，会带上 headless-authoring skill
- 改 `$GAME\assets\` → 自动补 `.meta`、打包、热更
- 业务节点要 typed 访问 → bind + `POST /__viewweaver`

## 失败对照

| 现象 | 处理 |
|------|------|
| `ready: false` / `missing pinned 3.8.8 runtime` | 第 2 步拿 zip 或 bake，禁止装 Creator |
| `unknown template: base-ai` | 不在 `feat/artist-preview-design`，先 checkout |
| 端口占用 | 换 `PORT` 或杀掉旧 `preview-mirror` |
| 本机 `git push` 异常 | 全部改用 `hutao` |
| 工程出现在 `D:\tempWorkspace\...` 但用户工作区不是那里 | 文案抄死了；停下来改用 ROOT，不要继续在错误目录装 |
