/**
 * Loading H5 预览队列：单飞；每次默认强制确定性重建（不走旧缓存）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { prepareJobAgentWorkspace } from './cursorCli.mjs';
import { buildLoadingH5, LOADING_ASSET_PROFILE } from '../scripts/build-loading-h5.mjs';

/**
 * @param {{
 *   store: ReturnType<import('./jobs.mjs').createJobStore>,
 *   publicBase: string,
 *   skillsRoot: string,
 *   templatesDir: string,
 * }} opts
 */
export function createLoadingPreviewQueue(opts) {
  const { store, publicBase, skillsRoot, templatesDir } = opts;

  /** @type {string|null} */
  let busyJobId = null;
  /** @type {{id: string, force: boolean}[]} */
  const q = [];

  function previewStatePath(id) {
    return path.join(store.jobDir(id), 'loading-preview.json');
  }

  function readState(id) {
    const p = previewStatePath(id);
    if (!fs.existsSync(p)) return null;
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      return null;
    }
  }

  function writeState(id, patch) {
    const cur = readState(id) || {};
    const next = {
      ...cur,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(previewStatePath(id), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    return next;
  }

  function loadingUrl(id) {
    return `${publicBase}/preview/${id}/loading/`;
  }

  function hasValidOutput(id) {
    const indexHtml = path.join(store.jobDir(id), 'loading-h5', 'index.html');
    const manifestPath = path.join(store.jobDir(id), 'loading-h5', 'manifest.json');
    if (!fs.existsSync(indexHtml) || !fs.existsSync(manifestPath)) return false;
    try {
      const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      return m.assetProfile === LOADING_ASSET_PROFILE;
    } catch {
      return false;
    }
  }

  /**
   * @param {string} jobId
   * @param {{ force?: boolean }} [opts]
   */
  function enqueue(jobId, opts = {}) {
    if (!jobId) return { ok: false, error: 'missing job id' };
    // 默认强制重建；仅显式 force:false / useCache 才跳过（当前 UI 不传）
    const force = opts.force !== false;

    if (!force && hasValidOutput(jobId)) {
      const url = loadingUrl(jobId);
      writeState(jobId, {
        status: 'ready',
        previewUrl: url,
        error: null,
        cached: true,
      });
      store.appendLog(jobId, `loading-preview cache hit → ${url}`);
      return {
        ok: true,
        status: 'ready',
        jobId,
        cached: true,
        previewUrl: url,
      };
    }

    if (busyJobId === jobId || q.some((x) => x.id === jobId)) {
      return { ok: true, status: 'running', jobId, deduped: true };
    }
    if (busyJobId && busyJobId !== jobId) {
      return {
        ok: false,
        statusCode: 409,
        error: `busy: loading-preview running for ${busyJobId}`,
        busyJobId,
      };
    }
    q.push({ id: jobId, force });
    writeState(jobId, {
      status: 'queued',
      previewUrl: null,
      error: null,
      cached: false,
    });
    store.appendLog(jobId, 'loading-preview queued (rebuild)');
    pump();
    return { ok: true, status: 'queued', jobId, cached: false };
  }

  async function pump() {
    if (busyJobId) return;
    const item = q.shift();
    if (!item) return;
    busyJobId = item.id;
    try {
      await runOne(item.id);
    } catch (e) {
      console.error('[loading-preview]', item.id, e);
    } finally {
      busyJobId = null;
      if (q.length) setImmediate(() => pump());
    }
  }

  async function runOne(id) {
    const meta = store.readMeta(id);
    if (!meta) return;
    const layers = path.join(store.jobDir(id), 'exports', 'layers.json');
    if (!fs.existsSync(layers)) {
      writeState(id, {
        status: 'error',
        error: 'exports/layers.json missing — parse first',
      });
      store.appendLog(id, 'loading-preview failed: no layers.json');
      return;
    }

    writeState(id, { status: 'running', error: null, previewUrl: null });
    store.writeMeta(id, { stage: 'loading_preview' });
    store.appendLog(id, 'loading-preview rebuild started');

    const jobDir = store.jobDir(id);
    const logFile = path.join(jobDir, 'logs', 'loading-preview.log');
    const appendRunLog = (line) => {
      const stamp = new Date().toISOString();
      fs.appendFileSync(logFile, `[${stamp}] ${line}\n`, 'utf8');
      store.appendLog(id, `[build] ${String(line).slice(0, 500)}`);
    };

    try {
      prepareJobAgentWorkspace(jobDir, skillsRoot);
    } catch (e) {
      appendRunLog(`prepare workspace warn: ${e?.message || e}`);
    }

    try {
      await buildLoadingH5(jobDir, { templatesDir });
      appendRunLog(`buildLoadingH5 ok (${LOADING_ASSET_PROFILE})`);
    } catch (e) {
      writeState(id, {
        status: 'error',
        error: e?.message || String(e),
      });
      store.appendLog(id, `loading-preview build failed: ${e?.message || e}`);
      return;
    }

    if (!hasValidOutput(id)) {
      writeState(id, {
        status: 'error',
        error: 'loading-h5 missing or asset profile mismatch after build',
      });
      store.appendLog(id, 'loading-preview failed: bad loading-h5 output');
      return;
    }

    const url = loadingUrl(id);
    writeState(id, {
      status: 'ready',
      previewUrl: url,
      error: null,
      cached: false,
      backend: 'deterministic',
    });
    store.writeMeta(id, {
      loadingPreviewUrl: url,
      stage: 'loading_preview_ready',
    });
    store.appendLog(id, `loading-preview ready → ${url}`);
  }

  return {
    enqueue,
    readState,
    isBusy: () => busyJobId,
  };
}
