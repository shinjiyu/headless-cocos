# Headless Cocos — Cursor / Agent 搭建

**唯一入口。** 只丢这一份 URL。按顺序做完：预览栈、钉死版本运行时、工程、预览、改工程知识。不要再找第二份入口。

不要装 / 开 Cocos Creator。不要 MCP。

钉死版本：**3.8.8**（运行时包，不是本机 IDE）。

- 栈：https://github.com/shinjiyu/headless-cocos
- 模板：https://github.com/shinjiyu/baseAIAutoCocos/tree/headless
- 本入口：https://raw.githubusercontent.com/shinjiyu/headless-cocos/feat/artist-preview-design/AGENT_SETUP.md

## 路径（先算，再跑命令）

所有命令只用下面三个变量。**禁止**在命令里写任何盘符、用户名、或你脑子里的「常用目录」。

| 变量 | 怎么定 |
|------|--------|
| `ROOT` | 当前工作区根目录（`pwd` / workspace）。用户另指定路径则用用户的。 |
| `STACK` | `ROOT` 已有 `spike/preview-mirror.mjs` → 就是 `ROOT`。否则 `STACK` = `ROOT` 下的 `headless-cocos` 子目录（clone 到那里）。 |
| `GAME` | 用户指定了工程目录就用指定的。否则 = `ROOT` 下的 `project` 子目录。 |

先 `pwd` 得到 `ROOT`，再拼 `STACK` / `GAME`。报告给用户时写你算出的绝对路径，不要写本文里的变量名当路径。

## 禁止

- 安装 / 启动 Cocos Creator
- `cocosmcp` / MCP / `Editor.Message`
- 官方 Empty 模板
- PA 的 MainUI / CTA / 盘面当默认工程
- 把工程或栈放到 `ROOT` 以外的地方

## 0. 前提

Node.js ≥ 20。没有就让用户装 Node，不是 Creator。

```powershell
node -v
```

## 1. 克隆预览栈

`ROOT` 已是栈则跳过 clone，`cd` 到 `STACK` 即可。

```powershell
git clone https://github.com/shinjiyu/headless-cocos.git $STACK
cd $STACK
git checkout feat/artist-preview-design
npm install
```

本机 git 被拦截时，所有 git 改用 `hutao`。

## 2. 准备 3.8.8 运行时包

在 `STACK` 下：

```powershell
node -e "console.log(JSON.stringify(require('./spike/runtime-kit.cjs').kitStatus(),null,2))"
```

`ready: true` → 第 3 步。否则按序试，成功一个就停：

1. 用户给了 zip 或 `HEADLESS_RUNTIME_URL` → `node spike/fetch-runtime.mjs`，或解压到 `STACK/runtime/3.8.8/`（需含 `engine/preview` 与 `@cocos/creator-programming-quick-pack`）。
2. `STACK` 里已有 `docker/build-context/engine`+`vendor` 或 `spike/engine-snapshot` → `node spike/bake-runtime.mjs`。
3. 都没有 → **不要装 Creator**。继续第 3 步建工程，然后告诉用户：预览缺 `headless-runtime-3.8.8.zip`，放到 `STACK/runtime/3.8.8/` 后再开 preview。停住等包。

## 3. 建工程

```powershell
cd $STACK
node spike/bootstrap.mjs --out $GAME
```

拷的是 `templates/base-ai-headless`（同源 baseAIAutoCocos `headless` 分支）。kit 未就绪时 bootstrap 会失败，改：

```powershell
node spike/create-project.mjs --template base-ai --out $GAME
```

改 prefab / scene 直接改 JSON，不要找节点树 API。

## 4. 启动预览

仅 `ready: true` 时：

```powershell
cd $STACK
$env:PACKER = "mini"
$env:PORT = "<空闲端口>"
$env:PROJECT = $GAME
node spike/preview-mirror.mjs
```

端口：先试 7460，占用就递增，把**实际端口**告诉用户。不要去复用已经在听的别人的预览。

后台跑。日志必须有：`PROJECT=` 等于 `GAME`、`ENGINE_SNAPSHOT=` 指向 kit（不是本机 Creator 安装目录）、`build#1 ok`、`http://127.0.0.1:<PORT>`。

浏览器打开该地址，不要带 `autoReload=false`。

## 5. 装知识并读

`bootstrap` / `create-project` 已写入：

- `$GAME/AGENT_AUTHORING.md`
- `$GAME/.cursor/skills/headless-authoring/SKILL.md`

**立刻 Read `$GAME/AGENT_AUTHORING.md`**。之后改工程只跟它走。

缺失则：`Copy-Item $STACK/AGENT_AUTHORING.md $GAME/AGENT_AUTHORING.md`

向用户交代真实绝对路径：入口跑完；以后打开 `GAME`；改 `GAME/assets` 会 HMR；typed 访问节点则 bind + `POST /__viewweaver`。

## 失败对照

| 现象 | 处理 |
|------|------|
| `ready: false` | 第 2 步拿 zip 或 bake，禁止装 Creator |
| `unknown template: base-ai` | 不在 `feat/artist-preview-design`，先 checkout |
| 端口占用 | 换空闲 `PORT` |
| git 异常 | 改用 `hutao` |
| 产物不在 `ROOT` 下 | 算错路径；停，按第 0 节重算，不要继续往别处装 |
