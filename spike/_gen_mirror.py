from pathlib import Path
Path(r"d:/tempWorkspace/headless-cocos-research/spike/preview-mirror.mjs").write_text("""#!/usr/bin/env node
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 7460);
const PROJECT = path.resolve(process.env.PROJECT || 'd:/tempWorkspace/baseAIAutoCocos');
const CREATOR = process.env.CREATOR_ROOT || 'C:/ProgramData/cocos/editors/Creator/3.8.8';
const UPSTREAM = process.env.PREVIEW_UPSTREAM || '';
const CACHE = path.join(__dirname, 'cache');
const ENGINE_PREVIEW = path.join(CREATOR, 'resources/resources/3d/engine/bin/.cache/dev/preview');
const PACK_PREVIEW = path.join(PROJECT, 'temp/programming/packer-driver/targets/preview');
const LIBRARY = path.join(PROJECT, 'library');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.bin': 'application/octet-stream',
};

function send(res, status, body, ctype, via) {
  const headers = {
    'Content-Type': ctype || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  };
  if (via) headers['X-Preview-Mirror'] = via;
  res.writeHead(status, headers);
  res.end(body);
}

function sendFile(res, filePath, via) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return false;
  const ext = path.extname(filePath).toLowerCase();
  send(res, 200, fs.readFileSync(filePath), MIME[ext] || 'application/octet-stream', via || 'disk');
  return true;
}

function safeJoin(root, rel) {
  const full = path.normalize(path.join(root, rel));
  if (!full.startsWith(path.normalize(root))) return null;
  return full;
}

const SOCKET_IO_STUB = [
  'window.io = function io() {',
  '  return { on(){return this;}, emit(){return this;}, off(){return this;}, disconnect(){} };',
  '};',
  'window.io.default = window.io;',
  'export default window.io;',
].join('\\n');

async function proxy(req, res) {
  if (!UPSTREAM) {
    send(res, 404, 'not found: ' + req.url, 'text/plain; charset=utf-8', 'miss');
    return;
  }
  try {
    const url = UPSTREAM.replace(/\\/$/, '') + req.url;
    const r = await fetch(url, { headers: { accept: req.headers.accept || '*/*' } });
    const buf = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, {
      'Content-Type': r.headers.get('content-type') || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'X-Preview-Mirror': 'proxy',
    });
    res.end(buf);
  } catch (e) {
    send(res, 502, 'upstream error: ' + e.message, 'text/plain; charset=utf-8', 'error');
  }
}

function mapPath(urlPath) {
  const q = urlPath.indexOf('?');
  const p = q >= 0 ? urlPath.slice(0, q) : urlPath;
  if (p === '/' || p === '/index.html') return path.join(CACHE, 'index.html');
  if (p === '/index.css') return path.join(CACHE, 'index.css');
  if (p === '/favicon.ico') return path.join(CACHE, 'favicon.ico');
  if (p === '/settings.js' || p.startsWith('/settings.js')) return path.join(CACHE, 'settings.js');
  if (p === '/scripting/polyfills/bundle.js') return path.join(CACHE, 'polyfills-bundle.js');
  if (p === '/scripting/systemjs/system.js') return path.join(CACHE, 'systemjs-system.js');
  if (p === '/scripting/import-map-global') return path.join(CACHE, 'import-map-global.json');
  if (p === '/preview-app/index.js') return path.join(CACHE, 'preview-app-index.js');
  if (p === '/preview-app/ui.js') return path.join(CACHE, 'preview-app-ui.js');
  if (p === '/preview-app/main.js') return path.join(CACHE, 'preview-app-main.js');
  if (p.startsWith('/scripting/x/')) return safeJoin(PACK_PREVIEW, p.slice('/scripting/x/'.length));
  if (p.startsWith('/scripting/engine/bin/.cache/dev/preview/')) {
    return safeJoin(ENGINE_PREVIEW, p.slice('/scripting/engine/bin/.cache/dev/preview/'.length));
  }
  const m = p.match(/^\\/scene\\/([0-9a-fA-F-]{36})\\.json$/);
  if (m) return path.join(LIBRARY, m[1].slice(0, 2), m[1] + '.json');
  return null;
}

const server = http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent(req.url || '/');
  console.log(req.method, urlPath);
  if (urlPath.startsWith('/socket.io/socket.io.js')) {
    send(res, 200, SOCKET_IO_STUB, 'application/javascript; charset=utf-8', 'stub');
    return;
  }
  const mapped = mapPath(urlPath);
  if (mapped && sendFile(res, mapped, 'disk')) return;
  await proxy(req, res);
});

server.listen(PORT, () => {
  console.log('[preview-mirror] http://127.0.0.1:' + PORT);
  console.log('  PROJECT=' + PROJECT);
  console.log('  PACK=' + PACK_PREVIEW);
  console.log('  ENGINE=' + ENGINE_PREVIEW);
  console.log('  UPSTREAM=' + (UPSTREAM || '(none)'));
});
""", encoding="utf-8")
print("ok")
