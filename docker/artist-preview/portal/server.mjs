import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJobStore } from './lib/jobs.mjs';
import { parsePsdUpload } from './lib/multipart.mjs';
import { exportPsdTiles } from './lib/exportPsdTiles.mjs';
import { createParseQueue } from './lib/parseQueue.mjs';
import { createLoadingPreviewQueue } from './lib/loadingPreviewQueue.mjs';
import { resolveCursorApiKey } from './lib/resolveCursorKey.mjs';
import { resolveAgentLaunch } from './lib/cursorCli.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');

const PORT = Number(process.env.PORT || 8800);
const JOBS_ROOT = path.resolve(process.env.JOBS_ROOT || path.join(__dirname, '../data/jobs'));
const PUBLIC_BASE = (process.env.PUBLIC_BASE || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 2 * 1024 * 1024 * 1024);
const PARSE_MAX_TILES = Number(process.env.PARSE_MAX_TILES || 0);
const SKILLS_ROOT = path.resolve(
  process.env.SKILLS_ROOT || path.join(__dirname, '../.cursor/skills'),
);
const LOADING_TEMPLATES_DIR = path.resolve(
  process.env.LOADING_TEMPLATES_DIR ||
    path.join(SKILLS_ROOT, 'loading-h5-preview/templates'),
);

const store = createJobStore(JOBS_ROOT);
const parseQueue = createParseQueue({
  store,
  exportPsdTiles,
  maxTiles: PARSE_MAX_TILES,
});
const loadingPreviewQueue = createLoadingPreviewQueue({
  store,
  publicBase: PUBLIC_BASE,
  skillsRoot: SKILLS_ROOT,
  templatesDir: LOADING_TEMPLATES_DIR,
});

const cursorKeyInfo = resolveCursorApiKey();
if (cursorKeyInfo.key && !String(process.env.CURSOR_API_KEY || '').trim()) {
  process.env.CURSOR_API_KEY = cursorKeyInfo.key;
}

function mime(p) {
  if (p.endsWith('.html')) return 'text/html; charset=utf-8';
  if (p.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (p.endsWith('.css')) return 'text/css; charset=utf-8';
  if (p.endsWith('.json')) return 'application/json';
  if (p.endsWith('.png')) return 'image/png';
  if (p.endsWith('.webp')) return 'image/webp';
  if (p.endsWith('.avif')) return 'image/avif';
  if (p.endsWith('.psd') || p.endsWith('.psb')) return 'image/vnd.adobe.photoshop';
  return 'application/octet-stream';
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function sendText(res, code, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(code, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) {
        reject(Object.assign(new Error('body too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function enrich(meta) {
  if (!meta) return null;
  const id = meta.id;
  return {
    ...meta,
    psdUrl: `${PUBLIC_BASE}/api/jobs/${id}/psd`,
    editorUrl: `${PUBLIC_BASE}/editor/?job=${encodeURIComponent(id)}`,
    layersUrl: `${PUBLIC_BASE}/api/jobs/${id}/exports/layers.json`,
    sceneEditUrl: `${PUBLIC_BASE}/api/jobs/${id}/scene-edit`,
    previewUrl:
      meta.previewUrl ||
      (meta.status === 'ready' ? `${PUBLIC_BASE}/preview/${id}/` : null),
    loadingPreviewUrl: `${PUBLIC_BASE}/preview/${id}/loading/`,
    selfUrl: `${PUBLIC_BASE}/api/jobs/${id}`,
  };
}

function isPsdName(name) {
  const lower = String(name || '').toLowerCase();
  return lower.endsWith('.psd') || lower.endsWith('.psb');
}

function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  rel = decodeURIComponent(rel.split('?')[0]);
  if (rel.includes('..')) {
    sendJson(res, 400, { error: 'bad path' });
    return;
  }
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    sendJson(res, 404, { error: 'not found' });
    return;
  }
  res.writeHead(200, { 'Content-Type': mime(file), 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

function serveStaticRoot(res, root, subPath, { placeholder = null } = {}) {
  const indexExists = fs.existsSync(path.join(root, 'index.html'));
  if (!indexExists) {
    if (
      placeholder &&
      fs.existsSync(placeholder) &&
      (subPath === '/' || subPath === '/index.html' || !subPath)
    ) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(placeholder).pipe(res);
      return;
    }
    sendJson(res, 404, { error: 'preview not ready' });
    return;
  }

  let rel = subPath || '/';
  if (rel.endsWith('/')) rel += 'index.html';
  rel = decodeURIComponent(rel);
  if (rel.includes('..')) {
    sendJson(res, 400, { error: 'bad path' });
    return;
  }
  const file = path.join(root, rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    sendJson(res, 404, { error: 'not found' });
    return;
  }
  res.writeHead(200, { 'Content-Type': mime(file), 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

function servePreview(req, res, jobId, subPath) {
  const root = path.join(store.jobDir(jobId), 'web-mobile');
  const placeholder = path.join(__dirname, 'public', 'preview-placeholder.html');
  serveStaticRoot(res, root, subPath, { placeholder });
}

function serveLoadingPreview(res, jobId, subPath) {
  const root = path.join(store.jobDir(jobId), 'loading-h5');
  serveStaticRoot(res, root, subPath);
}

function serveExportFile(res, jobId, relPath) {
  const root = store.exportsDir(jobId);
  const clean = decodeURIComponent(relPath).replace(/^\/+/, '');
  if (clean.includes('..')) {
    sendJson(res, 400, { error: 'bad path' });
    return;
  }
  const file = path.join(root, clean);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    sendJson(res, 404, { error: 'export not found' });
    return;
  }
  res.writeHead(200, {
    'Content-Type': mime(file),
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*',
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const { pathname } = url;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    if (req.method === 'GET' && pathname === '/api/health') {
      sendJson(res, 200, {
        ok: true,
        service: 'psd-artist-preview-portal',
        milestone: 'M1.5+loading-h5',
        jobsRoot: JOBS_ROOT,
        parseMaxTiles: PARSE_MAX_TILES || null,
        editor: 'layers+tiles+scene-edit',
        cursorApiKey: Boolean(
          String(process.env.CURSOR_API_KEY || '').trim() || cursorKeyInfo.key,
        ),
        cursorApiKeySource: cursorKeyInfo.source
          ? path.basename(cursorKeyInfo.source) === 'config.local.json'
            ? cursorKeyInfo.source.includes('ai-game-workspace')
              ? 'aiws:config.local.json'
              : 'config.local.json'
            : cursorKeyInfo.source === 'env'
              ? 'env'
              : 'file'
          : 'missing',
        skillsRoot: SKILLS_ROOT,
        publicBase: PUBLIC_BASE,
        loadingPreviewBusy: loadingPreviewQueue.isBusy(),
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/jobs') {
      sendJson(res, 200, { jobs: store.listJobs().map(enrich) });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/jobs') {
      const uploaded = await parsePsdUpload(req, { maxBytes: MAX_UPLOAD_BYTES });
      if (!isPsdName(uploaded.filename)) {
        sendJson(res, 400, {
          error: 'file must be .psd or .psb',
          filename: uploaded.filename,
        });
        return;
      }
      if (!uploaded.buffer.length) {
        sendJson(res, 400, { error: 'empty file' });
        return;
      }
      const meta = store.createJob(
        {
          originalName: uploaded.filename,
          size: uploaded.buffer.length,
          mime: uploaded.mime,
        },
        uploaded.buffer,
      );
      parseQueue.enqueue(meta.id);
      sendJson(res, 201, enrich(meta));
      return;
    }

    const jobMatch = pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (req.method === 'GET' && jobMatch) {
      const meta = store.readMeta(jobMatch[1]);
      if (!meta) {
        sendJson(res, 404, { error: 'job not found' });
        return;
      }
      sendJson(res, 200, enrich(meta));
      return;
    }

    if (req.method === 'DELETE' && jobMatch) {
      const id = jobMatch[1];
      const existed = store.readMeta(id);
      if (!existed) {
        sendJson(res, 404, { error: 'job not found' });
        return;
      }
      const result = store.deleteJob(id);
      if (!result.ok) {
        sendJson(res, 400, { error: result.error || 'delete failed' });
        return;
      }
      sendJson(res, 200, { ok: true, deleted: id });
      return;
    }

    const parseMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/parse$/);
    if (req.method === 'POST' && parseMatch) {
      const id = parseMatch[1];
      if (!store.readMeta(id)) {
        sendJson(res, 404, { error: 'job not found' });
        return;
      }
      let maxTiles;
      try {
        const raw = await readBody(req, 64 * 1024);
        if (raw.length) {
          const body = JSON.parse(raw.toString('utf8'));
          if (body && body.maxTiles != null) maxTiles = Number(body.maxTiles);
        }
      } catch {
        /* empty body ok */
      }
      parseQueue.enqueue(id, { maxTiles });
      sendJson(res, 202, {
        ok: true,
        queued: id,
        maxTiles: maxTiles || PARSE_MAX_TILES || null,
        job: enrich(store.readMeta(id)),
      });
      return;
    }

    const sceneMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/scene-edit$/);
    if (sceneMatch) {
      const id = sceneMatch[1];
      if (!store.readMeta(id)) {
        sendJson(res, 404, { error: 'job not found' });
        return;
      }
      if (req.method === 'GET') {
        const doc = store.readSceneEdit(id) || {
          version: 1,
          updatedAt: null,
          bgLayerId: null,
          nodes: {},
          treeOrder: [],
          removedIds: [],
        };
        sendJson(res, 200, doc);
        return;
      }
      if (req.method === 'PUT') {
        const raw = await readBody(req);
        let body;
        try {
          body = JSON.parse(raw.toString('utf8') || '{}');
        } catch {
          sendJson(res, 400, { error: 'invalid json' });
          return;
        }
        const saved = store.writeSceneEdit(id, body);
        store.appendLog(id, `scene-edit saved (bg=${saved.bgLayerId || 'null'})`);
        sendJson(res, 200, saved);
        return;
      }
    }

    const exportMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/exports\/(.+)$/);
    if (req.method === 'GET' && exportMatch) {
      const id = exportMatch[1];
      if (!store.readMeta(id)) {
        sendJson(res, 404, { error: 'job not found' });
        return;
      }
      serveExportFile(res, id, exportMatch[2]);
      return;
    }

    const psdMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/psd$/);
    if (req.method === 'GET' && psdMatch) {
      const id = psdMatch[1];
      const meta = store.readMeta(id);
      const p = store.psdPath(id);
      if (!meta || !fs.existsSync(p)) {
        sendJson(res, 404, { error: 'psd not found' });
        return;
      }
      const name = meta.originalName || 'source.psd';
      res.writeHead(200, {
        'Content-Type': mime(name),
        'Content-Length': fs.statSync(p).size,
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      fs.createReadStream(p).pipe(res);
      return;
    }

    const logsMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/logs$/);
    if (req.method === 'GET' && logsMatch) {
      const id = logsMatch[1];
      if (!store.readMeta(id)) {
        sendJson(res, 404, { error: 'job not found' });
        return;
      }
      sendText(res, 200, store.readLogs(id) || '(no logs yet)\n');
      return;
    }

    const convertMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/convert$/);
    if (req.method === 'POST' && convertMatch) {
      const id = convertMatch[1];
      const meta = store.readMeta(id);
      if (!meta) {
        sendJson(res, 404, { error: 'job not found' });
        return;
      }
      store.appendLog(id, 'convert requested (M2 stub — not implemented)');
      sendJson(res, 501, {
        error: 'convert not implemented yet (M2)',
        job: enrich(meta),
        hint: 'M2 will run scene-edit + PSD→BG→split-bg-plus→baked web-mobile',
      });
      return;
    }

    const loadingMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/loading-preview$/);
    if (loadingMatch) {
      const id = loadingMatch[1];
      const meta = store.readMeta(id);
      if (!meta) {
        sendJson(res, 404, { error: 'job not found' });
        return;
      }
      if (req.method === 'GET') {
        let state = loadingPreviewQueue.readState(id);
        const indexHtml = path.join(store.jobDir(id), 'loading-h5', 'index.html');
        if ((!state || state.status === 'idle' || state.status === 'error') &&
            fs.existsSync(indexHtml)) {
          state = {
            status: 'ready',
            previewUrl: `${PUBLIC_BASE}/preview/${id}/loading/`,
            cached: true,
            error: null,
          };
        }
        const liveUrl = `${PUBLIC_BASE}/preview/${id}/loading/`;
        if (state && (state.status === 'ready' || state.cached)) {
          state = { ...state, previewUrl: liveUrl };
        }
        sendJson(res, 200, {
          ...(state || { status: 'idle', previewUrl: null, error: null }),
          job: enrich(meta),
        });
        return;
      }
      if (req.method === 'POST') {
        // 默认强制重建；仅 body/query useCache=1 时才允许缓存
        let force = true;
        if (url.searchParams.get('useCache') === '1') force = false;
        try {
          const raw = await readBody(req, 64 * 1024);
          if (raw.length) {
            const body = JSON.parse(raw.toString('utf8'));
            if (body && (body.useCache === true || body.force === false)) {
              force = false;
            }
            if (body && body.force === true) force = true;
          }
        } catch {
          /* empty body ok */
        }
        const result = loadingPreviewQueue.enqueue(id, { force });
        if (!result.ok) {
          sendJson(res, result.statusCode || 500, {
            error: result.error,
            busyJobId: result.busyJobId,
            job: enrich(meta),
          });
          return;
        }
        sendJson(res, result.cached ? 200 : 202, {
          ok: true,
          ...result,
          job: enrich(store.readMeta(id)),
          pollUrl: `${PUBLIC_BASE}/api/jobs/${id}/loading-preview`,
        });
        return;
      }
    }

    const loadingPreviewMatch = pathname.match(
      /^\/preview\/([^/]+)\/loading(\/.*)?$/,
    );
    if (req.method === 'GET' && loadingPreviewMatch) {
      serveLoadingPreview(
        res,
        loadingPreviewMatch[1],
        loadingPreviewMatch[2] || '/',
      );
      return;
    }

    const previewMatch = pathname.match(/^\/preview\/([^/]+)(\/.*)?$/);
    if (req.method === 'GET' && previewMatch) {
      servePreview(req, res, previewMatch[1], previewMatch[2] || '/');
      return;
    }

    // /editor and /editor/ → editor/index.html
    if (req.method === 'GET' && (pathname === '/editor' || pathname === '/editor/')) {
      serveStatic(req, res, '/editor/index.html');
      return;
    }

    if (req.method === 'GET') {
      serveStatic(req, res, pathname);
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    const code = err?.statusCode || 500;
    console.error('[portal]', err);
    sendJson(res, code, { error: err?.message || String(err) });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[portal] http://0.0.0.0:${PORT}`);
  console.log(`[portal] jobs → ${JOBS_ROOT}`);
  console.log(`[portal] publicBase → ${PUBLIC_BASE}`);
  console.log(`[portal] PARSE_MAX_TILES → ${PARSE_MAX_TILES || 'unlimited'}`);
  console.log(`[portal] skills → ${SKILLS_ROOT}`);
  console.log(
    `[portal] CURSOR_API_KEY → ${
      cursorKeyInfo.key ? `set (${cursorKeyInfo.source === 'env' ? 'env' : 'from file'})` : 'missing'
    }`,
  );
  try {
    const launch = resolveAgentLaunch(process.env.CURSOR_AGENT_BIN);
    console.log(`[portal] cursor-agent → ${launch.label}`);
  } catch (e) {
    console.log(`[portal] cursor-agent resolve failed: ${e?.message || e}`);
  }
});
