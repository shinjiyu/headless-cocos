/**
 * 串行解析队列：上传后异步 PSD→exports，避免并发撑爆内存。
 */
import path from 'node:path';

/**
 * @param {{
 *   store: ReturnType<import('./jobs.mjs').createJobStore>,
 *   exportPsdTiles: typeof import('./exportPsdTiles.mjs').exportPsdTiles,
 *   maxTiles: number,
 * }} opts
 */
export function createParseQueue({ store, exportPsdTiles, maxTiles }) {
  /** @type {{id: string, maxTiles?: number}[]} */
  const q = [];
  let running = false;

  function enqueue(jobId, opts = {}) {
    if (!jobId) return;
    if (q.some((x) => x.id === jobId)) return;
    q.push({ id: jobId, maxTiles: opts.maxTiles });
    pump();
  }

  async function pump() {
    if (running) return;
    const item = q.shift();
    if (!item) return;
    running = true;
    try {
      await runOne(item.id, item.maxTiles);
    } catch (e) {
      console.error('[parse-queue]', item.id, e);
    } finally {
      running = false;
      if (q.length) setImmediate(() => pump());
    }
  }

  async function runOne(id, overrideMax) {
    const meta = store.readMeta(id);
    if (!meta) return;
    const psd = store.psdPath(id);
    const outDir = path.join(store.jobDir(id), 'exports');
    const limit =
      overrideMax != null && overrideMax > 0
        ? overrideMax
        : maxTiles > 0
          ? maxTiles
          : 0;

    store.writeMeta(id, { status: 'parsing', stage: 'export_tiles', error: null });
    store.appendLog(id, `parse started${limit ? ` (maxTiles=${limit})` : ''}`);

    const name = String(meta.originalName || '').toLowerCase();
    if (name.endsWith('.psb')) {
      store.writeMeta(id, {
        status: 'failed',
        stage: 'parse',
        error: 'PSB not supported in M1.5 (use PSD or later psd-tools worker)',
      });
      store.appendLog(id, 'parse failed: PSB not supported yet');
      return;
    }

    try {
      const manifest = exportPsdTiles(psd, outDir, {
        maxTiles: limit,
        sourceLabel: meta.originalName || 'source.psd',
        onProgress: (msg) => store.appendLog(id, msg),
      });

      if (!store.readSceneEdit(id)) {
        store.writeSceneEdit(id, {
          version: 1,
          updatedAt: new Date().toISOString(),
          bgLayerId: null,
          nodes: {},
          treeOrder: [],
          removedIds: [],
        });
      }

      store.writeMeta(id, {
        status: 'edit_ready',
        stage: 'exports_ready',
        error: null,
        tileCount: manifest.tileCount,
        canvasWidth: manifest.width,
        canvasHeight: manifest.height,
        truncated: !!manifest.truncated,
      });
      store.appendLog(
        id,
        `parse ok: ${manifest.tileCount} tiles, ${manifest.width}x${manifest.height}` +
          (manifest.truncated ? ' (truncated)' : ''),
      );
    } catch (e) {
      const msg = e?.message || String(e);
      store.writeMeta(id, { status: 'failed', stage: 'parse', error: msg });
      store.appendLog(id, `parse failed: ${msg}`);
    }
  }

  return { enqueue };
}
