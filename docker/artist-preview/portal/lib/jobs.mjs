import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** @typedef {'uploaded'|'parsing'|'edit_ready'|'queued'|'splitting'|'assembling'|'ready'|'failed'|'photopea_ready'} JobStatus */

/**
 * @param {string} jobsRoot
 */
export function createJobStore(jobsRoot) {
  fs.mkdirSync(jobsRoot, { recursive: true });

  const jobDir = (id) => path.join(jobsRoot, id);
  const metaPath = (id) => path.join(jobDir(id), 'meta.json');

  /**
   * @param {Partial<{status: JobStatus, error: string|null, stage: string, previewUrl: string|null}>} patch
   */
  function writeMeta(id, patch) {
    const p = metaPath(id);
    const cur = JSON.parse(fs.readFileSync(p, 'utf8'));
    const next = {
      ...cur,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(p, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    return next;
  }

  function readMeta(id) {
    const p = metaPath(id);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  }

  /**
   * @param {{originalName: string, size: number, mime: string}} info
   * @param {Buffer} psdBuf
   */
  function createJob(info, psdBuf) {
    const id = crypto.randomUUID();
    const dir = jobDir(id);
    fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'exports'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'bg-plus'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'web-mobile'), { recursive: true });

    const psdPath = path.join(dir, 'source.psd');
    fs.writeFileSync(psdPath, psdBuf);

    const now = new Date().toISOString();
    const meta = {
      id,
      status: /** @type {JobStatus} */ ('uploaded'),
      stage: 'queued_parse',
      originalName: info.originalName,
      size: info.size,
      mime: info.mime || 'image/vnd.adobe.photoshop',
      error: null,
      previewUrl: null,
      createdAt: now,
      updatedAt: now,
      convertNote: 'M1.5: parse→editor; convert (M2) not wired',
    };
    fs.writeFileSync(metaPath(id), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
    appendLog(id, `job created; PSD saved (${info.size} bytes, ${info.originalName})`);
    return meta;
  }

  function appendLog(id, line) {
    const dir = jobDir(id);
    if (!fs.existsSync(dir)) return;
    const stamp = new Date().toISOString();
    fs.appendFileSync(
      path.join(dir, 'logs', 'job.log'),
      `[${stamp}] ${line}\n`,
      'utf8',
    );
  }

  function readLogs(id) {
    const p = path.join(jobDir(id), 'logs', 'job.log');
    if (!fs.existsSync(p)) return '';
    return fs.readFileSync(p, 'utf8');
  }

  function psdPath(id) {
    return path.join(jobDir(id), 'source.psd');
  }

  function exportsDir(id) {
    return path.join(jobDir(id), 'exports');
  }

  function sceneEditPath(id) {
    return path.join(jobDir(id), 'scene-edit.json');
  }

  function readSceneEdit(id) {
    const p = sceneEditPath(id);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  }

  function writeSceneEdit(id, doc) {
    const next = {
      version: 1,
      updatedAt: new Date().toISOString(),
      bgLayerId: null,
      nodes: {},
      groups: {},
      treeOrder: [],
      removedIds: [],
      ...doc,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(sceneEditPath(id), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    return next;
  }

  function listJobs(limit = 50) {
    if (!fs.existsSync(jobsRoot)) return [];
    const ids = fs
      .readdirSync(jobsRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    const metas = [];
    for (const id of ids) {
      const m = readMeta(id);
      if (m) metas.push(m);
    }
    metas.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return metas.slice(0, limit);
  }

  /** UUID 形 job id，防路径穿越 */
  function isSafeJobId(id) {
    return (
      typeof id === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        id,
      )
    );
  }

  /**
   * 删除整份稿件目录（源 PSD / exports / loading-h5 等）。
   * @returns {{ ok: true, id: string } | { ok: false, error: string }}
   */
  function deleteJob(id) {
    if (!isSafeJobId(id)) {
      return { ok: false, error: 'invalid job id' };
    }
    const dir = jobDir(id);
    const rootResolved = path.resolve(jobsRoot);
    const dirResolved = path.resolve(dir);
    if (
      dirResolved === rootResolved ||
      !dirResolved.startsWith(rootResolved + path.sep)
    ) {
      return { ok: false, error: 'invalid job path' };
    }
    if (!fs.existsSync(dirResolved)) {
      return { ok: false, error: 'job not found' };
    }
    fs.rmSync(dirResolved, { recursive: true, force: true });
    return { ok: true, id };
  }

  return {
    jobsRoot,
    createJob,
    readMeta,
    writeMeta,
    appendLog,
    readLogs,
    psdPath,
    exportsDir,
    readSceneEdit,
    writeSceneEdit,
    listJobs,
    deleteJob,
    isSafeJobId,
    jobDir,
  };
}
