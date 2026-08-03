/**
 * Loading / 预览扫码：优先用服务端 publicBase（公网反代地址）
 */
(function (global) {
  var cachedPublicBase = '';
  var fetching = null;

  function bp(path) {
    return typeof global.__artistPreviewUrl === 'function'
      ? global.__artistPreviewUrl(path)
      : path;
  }

  function ensureModal() {
    var el = document.getElementById('previewQrModal');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'previewQrModal';
    el.className = 'preview-qr-modal';
    el.hidden = true;
    el.innerHTML =
      '<div class="preview-qr-backdrop" data-qr-close="1"></div>' +
      '<div class="preview-qr-card" role="dialog" aria-modal="true" aria-labelledby="previewQrTitle">' +
      '<div class="preview-qr-head">' +
      '<h3 id="previewQrTitle">手机扫码预览</h3>' +
      '<button type="button" class="preview-qr-x" data-qr-close="1" title="关闭">×</button>' +
      '</div>' +
      '<div id="previewQrCanvas" class="preview-qr-canvas"></div>' +
      '<p class="preview-qr-hint">请用手机扫码打开（需能访问公网）</p>' +
      '<a id="previewQrLink" class="preview-qr-link" href="#" target="_blank" rel="noopener"></a>' +
      '<div class="preview-qr-actions">' +
      '<button type="button" class="btn ghost" id="previewQrCopy">复制链接</button>' +
      '<button type="button" class="btn primary" data-qr-close="1">关闭</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(el);
    el.addEventListener('click', function (ev) {
      if (ev.target && ev.target.getAttribute('data-qr-close') === '1') {
        hidePreviewQr();
      }
    });
    var copyBtn = el.querySelector('#previewQrCopy');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var link = el.querySelector('#previewQrLink');
        var url = link && link.href;
        if (!url) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(
            function () {
              copyBtn.textContent = '已复制';
              setTimeout(function () {
                copyBtn.textContent = '复制链接';
              }, 1500);
            },
            function () {
              prompt('复制链接', url);
            },
          );
        } else {
          prompt('复制链接', url);
        }
      });
    }
    return el;
  }

  function hidePreviewQr() {
    var el = document.getElementById('previewQrModal');
    if (el) el.hidden = true;
  }

  function fetchPublicBase() {
    if (cachedPublicBase) return Promise.resolve(cachedPublicBase);
    if (fetching) return fetching;
    fetching = fetch(bp('/api/health'))
      .then(function (r) {
        return r.json();
      })
      .then(function (h) {
        cachedPublicBase = String(h.publicBase || '').replace(/\/$/, '');
        global.__PUBLIC_BASE__ = cachedPublicBase;
        return cachedPublicBase;
      })
      .catch(function () {
        return '';
      })
      .finally(function () {
        fetching = null;
      });
    return fetching;
  }

  function toAbsolutePreviewUrl(pathOrUrl, publicBase) {
    if (!pathOrUrl) return '';
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    var path = pathOrUrl.charAt(0) === '/' ? pathOrUrl : '/' + pathOrUrl;
    var pub = String(publicBase || cachedPublicBase || global.__PUBLIC_BASE__ || '').replace(
      /\/$/,
      '',
    );
    if (pub) {
      try {
        var u = new URL(pub);
        var basePath = u.pathname.replace(/\/$/, '') || '';
        if (basePath && (path === basePath || path.indexOf(basePath + '/') === 0)) {
          return u.origin + path;
        }
        return pub + path;
      } catch (e) {
        return pub + path;
      }
    }
    return global.location.origin + path;
  }

  function renderQr(container, text) {
    container.innerHTML = '';
    if (typeof global.QRCode === 'function') {
      // qrcodejs
      // eslint-disable-next-line no-new
      new global.QRCode(container, {
        text: text,
        width: 220,
        height: 220,
        correctLevel: global.QRCode.CorrectLevel
          ? global.QRCode.CorrectLevel.M
          : undefined,
      });
      return;
    }
    var img = document.createElement('img');
    img.alt = 'QR';
    img.width = 220;
    img.height = 220;
    img.src =
      'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' +
      encodeURIComponent(text);
    container.appendChild(img);
  }

  function showPreviewQr(pathOrUrl, title) {
    return fetchPublicBase().then(function (pub) {
      var abs = toAbsolutePreviewUrl(pathOrUrl, pub);
      var modal = ensureModal();
      var titleEl = modal.querySelector('#previewQrTitle');
      if (titleEl) titleEl.textContent = title || '手机扫码预览';
      var link = modal.querySelector('#previewQrLink');
      if (link) {
        link.href = abs;
        link.textContent = abs;
      }
      var box = modal.querySelector('#previewQrCanvas');
      if (box) renderQr(box, abs);
      modal.hidden = false;
      return abs;
    });
  }

  global.__artistPreviewFetchPublicBase = fetchPublicBase;
  global.__artistPreviewAbsoluteUrl = toAbsolutePreviewUrl;
  global.showPreviewQr = showPreviewQr;
  global.hidePreviewQr = hidePreviewQr;

  // warm cache
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      fetchPublicBase();
    });
  } else {
    fetchPublicBase();
  }
})(typeof window !== 'undefined' ? window : globalThis);
