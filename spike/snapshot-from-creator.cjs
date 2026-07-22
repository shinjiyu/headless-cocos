#!/usr/bin/env node
/**
 * Snapshot preview statics + bundle configs from a running Creator preview (:7456).
 */
const fs = require('fs');
const http = require('http');
const path = require('path');

const UP = process.env.PREVIEW_UPSTREAM || 'http://127.0.0.1:7456';
const OUT = process.env.OUT || path.join(__dirname, 'cache');
const PATHS = [
  '/settings.js',
  '/index.html',
  '/index.css',
  '/favicon.ico',
  '/scripting/polyfills/bundle.js',
  '/scripting/systemjs/system.js',
  '/scripting/import-map-global',
  '/preview-app/index.js',
  '/preview-app/ui.js',
  '/preview-app/main.js',
  '/assets/internal/config.json',
  '/assets/internal/index.js',
  '/assets/main/config.json',
  '/assets/main/index.js',
  '/assets/resources/config.json',
  '/assets/resources/index.js',
  '/assets/Sound/config.json',
  '/assets/Sound/index.js',
  '/src/effect.bin',
];

function get(p) {
  return new Promise((resolve, reject) => {
    const url = UP.replace(/\/$/, '') + p;
    const req = http.get(url, { timeout: 15000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () =>
        resolve({ status: res.statusCode, buf: Buffer.concat(chunks), ctype: res.headers['content-type'] })
      );
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout ' + p));
    });
  });
}

function outPath(p) {
  if (p === '/settings.js') return path.join(OUT, 'settings.js');
  if (p === '/index.html') return path.join(OUT, 'index.html');
  if (p === '/index.css') return path.join(OUT, 'index.css');
  if (p === '/favicon.ico') return path.join(OUT, 'favicon.ico');
  if (p === '/scripting/polyfills/bundle.js') return path.join(OUT, 'polyfills-bundle.js');
  if (p === '/scripting/systemjs/system.js') return path.join(OUT, 'systemjs-system.js');
  if (p === '/scripting/import-map-global') return path.join(OUT, 'import-map-global.json');
  if (p === '/preview-app/index.js') return path.join(OUT, 'preview-app-index.js');
  if (p === '/preview-app/ui.js') return path.join(OUT, 'preview-app-ui.js');
  if (p === '/preview-app/main.js') return path.join(OUT, 'preview-app-main.js');
  if (p === '/src/effect.bin') return path.join(OUT, 'effect.bin');
  if (p.startsWith('/assets/')) return path.join(OUT, p.slice(1));
  return path.join(OUT, p.replace(/\//g, '_'));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const p of PATHS) {
    try {
      const r = await get(p);
      const dest = outPath(p);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (r.status === 200) {
        fs.writeFileSync(dest, r.buf);
        console.log('OK', r.status, r.buf.length, p, '->', path.relative(OUT, dest));
      } else {
        console.log('SKIP', r.status, p);
      }
    } catch (e) {
      console.log('FAIL', p, e.message);
    }
  }
})();
