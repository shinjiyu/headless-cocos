---
name: loading-h5-preview
description: >-
  根据 Loading PSD 切图（layers.json + tiles）生成纯 H5 Splash 预览页，
  结构模拟 Cocos web-mobile poke-splash，不引入 Cocos 引擎。
  Use when the user asks for Loading 页预览、Splash H5、loading-h5、
  或 artist-preview 触发 loading-preview 任务。
---

# Loading H5 Preview

## 目标

在 job 目录生成可手机/PC 打开的静态 Splash：

```text
loading-h5/
  index.html
  assets/          # 横/竖 BG、原画等
  progress.js
  manifest.json
```

**禁止**：安装/引用 Cocos、改 `source.psd`、`hutao commit`（除非用户明确要求）。

## 输入（cwd = job 根）

| 路径 | 用途 |
|------|------|
| `exports/layers.json` | 图层列表 |
| `exports/tiles/*.png` | 切图 |
| `scene-edit.json` | 显隐/重命名覆盖（可选） |

## 图层角色（按 path 名，可被 scene-edit 覆盖）

| 匹配 | 角色 | 处理 |
|------|------|------|
| `範圍` / `范围` | 安全框 | **不进包** |
| `背景` / `BG` | BG | BgPlus 适配缩放，中心对齐；横/竖各一 |
| **其余可见层** | **前景** | 同方向组内全部合成一张透明图（主体+LOGO+TAP…）；相对 BG 的 PSD 偏移锁定同一 scale |
| 组名含 `横` / `橫` | landscape | |
| 组名含 `竖` / `直` | portrait | |

进度条优先用壳内 **CSS 假进度**（不单独吃一层）。

有效可见 = 自身可见 ∧ 祖先可见（尊重 `scene-edit` / `effectiveHidden`）。

## 推荐执行（优先）

在 job 根运行确定性构建（仓库已提供）：

```bash
node /app/scripts/build-loading-h5.mjs --job-dir .
```

若脚本不在 `/app`，用相对路径：

```bash
node ../../portal/scripts/build-loading-h5.mjs --job-dir .
# 或 workspace 内已拷贝的 scripts/build-loading-h5.mjs
```

成功后应存在 `loading-h5/index.html`。可按需微调 CSS（原画尺寸、进度条位置），保持横竖 media query。

## 壳结构（对齐 dndh poke-splash）

- `#splash.poke-splash` 全屏 overflow:hidden；无 `#GameCanvas` 真引擎
- BG / 前景：绝对定位 `<img>`；**画布中心安全区 1120×630（竖 630×1120）铺满视口**
- 进度：视口底 UI 覆盖层，`ProgressController` 假进度约到 85%～90%
- `resize` / 横竖切换时重算 scale 与资源

模板参考：同目录 `templates/`。

## 资源策略

- **整图不切块**（不做五块纹理切片）
- 前景：同方向非背景层合成一张透明图
- 布局：PSD 画布中心裁 **1120×630 / 630×1120** 安全区并铺满屏幕（避免 contain 留白、LOGO 拉偏）
- 导出：统一长边上限 WebP（可选 AVIF）

## 验收

- [ ] `loading-h5/index.html` 存在且无 cocos/cc 脚本
- [ ] 横/竖切换背景与原画
- [ ] 假进度条走动
- [ ] 写 `loading-preview.json`：`{ "status": "ready" }`（若编排层未写）

## 详参

- [reference.md](reference.md)
