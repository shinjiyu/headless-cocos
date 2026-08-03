# Loading H5 参考（对齐 web-mobile Splash）

参考工程：`proj-l-client-dndh/build-templates/web-mobile/index.ejs` 的 `.poke-splash` 段。

## DOM 骨架

```html
<body>
  <div id="GameDiv" aria-hidden="true"></div>
  <div class="poke-splash" id="splash">
    <img class="splash-layer" id="splashBg" alt="" />
    <img class="splash-layer" id="splashArt" alt="" />
    <div class="poke-progress-wrap">
      <div class="progress-container">
        <div class="progress-bar" id="progressBar"></div>
        <div class="progress-text" id="progressText">0%</div>
      </div>
    </div>
  </div>
</body>
```

## CSS / 布局要点（BgPlus 十字切适配，不切图）

- `.poke-splash`：`position:fixed; inset:0; overflow:hidden; background:#000`（禁止 `background-size:cover`）
- 安全区 1120×630 / 630×1120，`FIXED_WIDTH`/`FIXED_HEIGHT` 算统一 scale
- BG：源像素×scale，**图中心 = 屏中心**；原画用 PSD left/top 相对 BG 锁定
- 进度条靠底：`bottom: calc(env(safe-area-inset-bottom) + 6vh)`（竖）/ `4vh`（横）

## 假进度

定时器缓增到 ~88%，暴露 `window.closeMGSplashProgress`（预览可不真正关页）。

## 与 Cocos 产物关系

本预览 **不是** `web-mobile` 全包；仅模拟 Splash 壳。  
真机买量包仍走 Creator 构建模板替换资源。
