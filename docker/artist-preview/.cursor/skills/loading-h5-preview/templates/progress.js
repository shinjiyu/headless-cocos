(function () {
  function ProgressController() {
    this.progressBar = document.getElementById('progressBar');
    this.progressText = document.getElementById('progressText');
    this.closed = false;
    this.percent = 0;
    this.timer = null;
    this.start();
  }

  ProgressController.prototype.setPercent = function (percent) {
    if (!this.progressBar || this.closed) return;
    this.percent = Math.max(0, Math.min(100, percent));
    this.progressBar.style.width = this.percent + '%';
    if (this.progressText) {
      this.progressText.textContent = Math.round(this.percent) + '%';
    }
  };

  ProgressController.prototype.start = function () {
    var self = this;
    var tick = function () {
      if (self.closed) return;
      if (self.percent < 88) {
        var step = self.percent < 40 ? 2.2 : self.percent < 70 ? 1.1 : 0.45;
        self.setPercent(self.percent + step);
        self.timer = setTimeout(tick, 280);
      }
    };
    tick();
  };

  ProgressController.prototype.closeProgress = function () {
    var self = this;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.setPercent(100);
    setTimeout(function () {
      var el = document.querySelector('.poke-splash');
      if (el) el.style.opacity = '0.35';
    }, 400);
  };

  var progressController = new ProgressController();
  window.closeMGSplashProgress = function () {
    progressController.closeProgress();
  };

  function supportsAvif() {
    if (typeof supportsAvif._ok === 'boolean') return supportsAvif._ok;
    try {
      var c = document.createElement('canvas');
      c.width = 1;
      c.height = 1;
      supportsAvif._ok = c.toDataURL('image/avif').indexOf('image/avif') === 0;
    } catch (e) {
      supportsAvif._ok = false;
    }
    return supportsAvif._ok;
  }

  function pickUrl(pack, fallback) {
    if (pack) {
      if (supportsAvif() && pack.avif) return pack.avif;
      if (pack.webp) return pack.webp;
    }
    return fallback || '';
  }

  /** AspectRatioAdapter9to16：1120×630 安全区铺满视口 */
  function designScale(sw, sh, longSide, shortSide) {
    var designRatio = longSide / shortSide;
    if (sw >= sh) {
      return sw / sh < designRatio ? sw / longSide : sh / shortSide;
    }
    return sh / sw < designRatio ? sh / longSide : sw / shortSide;
  }

  function loadImg(el, url) {
    return new Promise(function (resolve) {
      if (!el || !url) {
        resolve();
        return;
      }
      if (el.dataset.src === url && el.naturalWidth) {
        resolve();
        return;
      }
      el.onload = function () {
        el.dataset.src = url;
        resolve();
      };
      el.onerror = function () {
        resolve();
      };
      el.src = url;
    });
  }

  /**
   * 布局：以 PSD 画布中心的设计安全区（横 1120×630 / 竖 630×1120）铺满屏幕。
   * BG / 前景按 PSD 坐标相对该安全区对齐，避免：
   * - contain 前景框 → 宽屏两侧留白
   * - 按前景 bbox 居中 → 被右侧 LOGO 拉偏
   */
  function applyAssets() {
    var m = window.__LOADING_MANIFEST__ || {};
    var design = m.design || { long: 1120, short: 630 };
    var longSide = design.long || 1120;
    var shortSide = design.short || 630;
    var sw = window.innerWidth || document.documentElement.clientWidth || 1;
    var sh = window.innerHeight || document.documentElement.clientHeight || 1;
    var land = sw >= sh;
    var scale = designScale(sw, sh, longSide, shortSide);

    var designW = land ? longSide : shortSide;
    var designH = land ? shortSide : longSide;
    var canvasW = (m.canvas && m.canvas.width) || designW;
    var canvasH = (m.canvas && m.canvas.height) || designH;
    var frameL = (canvasW - designW) / 2;
    var frameT = (canvasH - designH) / 2;

    var stageW = designW * scale;
    var stageH = designH * scale;
    var stageLeft = (sw - stageW) / 2;
    var stageTop = (sh - stageH) / 2;

    var bgPack = land
      ? (m.bg && m.bg.landscape) || null
      : (m.bg && (m.bg.portrait || m.bg.landscape)) || null;
    var artPack = land
      ? (m.art && m.art.landscape) || null
      : (m.art && (m.art.portrait || m.art.landscape)) || null;

    var bgUrl = pickUrl(
      bgPack,
      land ? m.bgLandscape : m.bgPortrait || m.bgLandscape,
    );
    var artUrl = pickUrl(
      artPack,
      land ? m.artLandscape : m.artPortrait || m.artLandscape,
    );

    var bgEl = document.getElementById('splashBg');
    var artEl = document.getElementById('splashArt');
    if (!bgEl) return;

    Promise.all([loadImg(bgEl, bgUrl), loadImg(artEl, artUrl)]).then(function () {
      var bgW = (bgPack && (bgPack.srcWidth || bgPack.width)) || bgEl.naturalWidth || 1;
      var bgH = (bgPack && (bgPack.srcHeight || bgPack.height)) || bgEl.naturalHeight || 1;
      var bgLeft = bgPack && bgPack.left != null ? bgPack.left : 0;
      var bgTop = bgPack && bgPack.top != null ? bgPack.top : 0;

      bgEl.style.width = bgW * scale + 'px';
      bgEl.style.height = bgH * scale + 'px';
      bgEl.style.left = stageLeft + (bgLeft - frameL) * scale + 'px';
      bgEl.style.top = stageTop + (bgTop - frameT) * scale + 'px';

      if (!artEl || !artUrl || !artPack) {
        if (artEl) artEl.style.display = 'none';
        return;
      }
      artEl.style.display = 'block';
      var aw = artPack.srcWidth || artPack.width || artEl.naturalWidth || 1;
      var ah = artPack.srcHeight || artPack.height || artEl.naturalHeight || 1;
      var artLeft = artPack.left != null ? artPack.left : 0;
      var artTop = artPack.top != null ? artPack.top : 0;
      artEl.style.width = aw * scale + 'px';
      artEl.style.height = ah * scale + 'px';
      artEl.style.left = stageLeft + (artLeft - frameL) * scale + 'px';
      artEl.style.top = stageTop + (artTop - frameT) * scale + 'px';
    });
  }

  applyAssets();
  window.addEventListener('orientationchange', function () {
    setTimeout(applyAssets, 60);
  });
  window.addEventListener('resize', applyAssets);
})();
