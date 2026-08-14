# Headless Cocos 模板库

给无头预览用的工程壳。不是官方 Empty（没有 `assets/`），也不是 PA 盘面。

默认模板 **base-ai**：[baseAIAutoCocos](https://github.com/shinjiyu/baseAIAutoCocos) 的无头版。

| | |
|--|--|
| 有 | ViewWeaver、3.8.8 `settings/`、可启动 `PreviewBoot`、`resources` bundle |
| 无 | MCP、`cocos-meta-mcp`、Board / MainUI / CTA |
| 改 UI | 直接改 `assets/**/*.prefab` / `.scene` JSON，磁盘即真相 |
| 引擎 | 预埋在 `spike/engine-snapshot/`（或 `templates/runtime/engine-snapshot/`），预览自动找，不必开 Creator |

对外发布的工程壳：[baseAIAutoCocos `headless` 分支](https://github.com/shinjiyu/baseAIAutoCocos/tree/headless)（不同场景用不同分支）。

```powershell
node spike/create-project.mjs --template base-ai --out D:\tempWorkspace\my-game
$env:PROJECT="D:\tempWorkspace\my-game"
$env:PACKER="mini"
node spike/preview-mirror.mjs
```

刷新壳（从本机 baseAIAutoCocos checkout，剥掉 MCP）：

```powershell
node spike/pack-base-ai-headless.mjs --from D:\tempWorkspace\baseAIAutoCocos
node spike/pack-base-ai-headless.mjs --export D:\tempWorkspace\baseAIAutoCocos-headless
```
