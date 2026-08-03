/** 公网子路径 /psd 与本机根路径兼容 */
(function (global) {
  function detectBasePath() {
    try {
      var forced = global.__BASE_PATH__;
      if (typeof forced === 'string' && forced) {
        return forced.replace(/\/$/, '');
      }
      var p = global.location && global.location.pathname ? global.location.pathname : '';
      if (p === '/psd' || p.indexOf('/psd/') === 0) return '/psd';
    } catch (e) {
      /* ignore */
    }
    return '';
  }

  function withBase(path) {
    var base = detectBasePath();
    if (!path) return base || '/';
    if (/^https?:\/\//i.test(path)) return path;
    if (path.charAt(0) !== '/') path = '/' + path;
    if (base && path.indexOf(base + '/') === 0) return path;
    if (base && path === base) return path;
    return base + path;
  }

  global.__artistPreviewBasePath = detectBasePath;
  global.__artistPreviewUrl = withBase;
})(typeof window !== 'undefined' ? window : globalThis);
