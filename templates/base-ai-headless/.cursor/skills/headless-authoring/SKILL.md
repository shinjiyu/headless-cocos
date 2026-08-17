---
name: headless-authoring
description: >-
  Headless Cocos 改工程：直接改 assets 下 prefab/scene JSON、丢资源等 mint meta、
  业务 UI 必须跑本工程 ViewWeaver（POST /__viewweaver）。使用时机：改 prefab、
  scene、加图、绑 View、用户说 ViewWeaver / bind.json / HMR。不要装 Creator、不要 MCP。
---

# Headless authoring

先读工程根目录的 `AGENT_AUTHORING.md`（搭建时从预览栈拷入），按那份执行。

摘要：

- 磁盘是唯一真相。改 `assets/`，等预览 HMR。
- 禁止 Creator / `cocosmcp` / `Editor.Message`。
- 业务节点要 `view.xxx` → 写入 bind → `POST /__viewweaver`。只改 XY / 换图不必跑。
- 场景 / Prefab 挂自定义脚本时，`__type__` 使用 chunk 中 `_RF.push` 注册的压缩 Class ID，不能使用 `.ts.meta` 完整 UUID。
- 禁止手改 `*.gen.ts`，禁止无必要 `--regen-bind`，禁止改已有 `.meta` uuid。
- 只用本工程 `extensions/viewweaver`，不要外带 CLI。
