# Headless Cocos

只按本文做。不要装 Creator，不要 MCP，不要抽 asar，不要读仓库里其它文档。

运行时已经在仓库的 `runtime/3.8.8/`，clone 下来就能用。

## 路径

先 `pwd` 得到 `ROOT`（当前工作区；用户指定了目录就用用户的）。再算：

- `STACK`：`ROOT` 里已有 `spike/preview-mirror.mjs` → 就是 `ROOT`。否则 = `ROOT/headless-cocos`
- `GAME`：用户指定了工程目录就用指定的。否则 = `ROOT/project`

命令里只写算出来的绝对路径，不要抄盘符或别人的目录。

## 1. 克隆

```powershell
git clone https://github.com/shinjiyu/headless-cocos.git $STACK
cd $STACK
git checkout feat/artist-preview-design
npm install
```

## 2. 建工程

```powershell
cd $STACK
node spike/bootstrap.mjs --out $GAME
```

## 3. 预览

```powershell
cd $STACK
$env:PACKER = "mini"
$env:PORT = "7460"
$env:PROJECT = $GAME
node spike/preview-mirror.mjs
```

7460 占用就换 7461、7462。后台跑。打开日志里的 `http://127.0.0.1:<PORT>/`。

## 4. 改工程

立刻读 `$GAME/AGENT_AUTHORING.md`。之后只跟它走。
