const $ = (id) => document.getElementById(id);

const healthEl = $('health');
const fileInput = $('file');
const refreshBtn = $('refreshBtn');
const statusEl = $('status');
const jobsEl = $('jobs');
const currentEl = $('current');
const currentActions = $('currentActions');
const psdLink = $('psdLink');
const previewLink = $('previewLink');
const editorLink = $('editorLink');
const convertBtn = $('convertBtn');
const loadingPreviewBtn = $('loadingPreviewBtn');
const loadingPreviewLink = $('loadingPreviewLink');
const loadingQrBtn = $('loadingQrBtn');
const parseBtn = $('parseBtn');
const logsEl = $('logs');
const stageTitle = $('stageTitle');
const stageHint = $('stageHint');
const drop = $('drop');

/** @type {string|null} */
let currentId = null;
/** @type {object|null} */
let currentJob = null;
let uploading = false;
/** @type {ReturnType<typeof setInterval>|null} */
let pollTimer = null;
/** @type {ReturnType<typeof setInterval>|null} */
let loadingPollTimer = null;

function logStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
}

function stopLoadingPoll() {
  if (loadingPollTimer) {
    clearInterval(loadingPollTimer);
    loadingPollTimer = null;
  }
}

function setLoadingLink(url, visible) {
  if (!loadingPreviewLink) return;
  if (url) loadingPreviewLink.href = url;
  loadingPreviewLink.hidden = !visible;
  if (loadingQrBtn) {
    loadingQrBtn.hidden = !visible;
    if (url) loadingQrBtn.dataset.url = url;
  }
}

let toastTimer = null;
function showTaskToast(msg, { kind, hideSpin, autoHideMs } = {}) {
  const toast = $('taskToast');
  const msgEl = $('taskToastMsg');
  const spin = $('taskToastSpin');
  if (!toast || !msgEl) return;
  msgEl.textContent = msg || '';
  toast.classList.remove('is-error', 'is-ok');
  if (kind === 'error') toast.classList.add('is-error');
  if (kind === 'ok') toast.classList.add('is-ok');
  if (spin) spin.hidden = !!hideSpin;
  toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  if (autoHideMs) {
    toastTimer = setTimeout(() => hideTaskToast(), autoHideMs);
  }
}

function hideTaskToast() {
  const toast = $('taskToast');
  if (toast) toast.classList.remove('show', 'is-error', 'is-ok');
}

function setLoadingPreviewBusy(busy, label) {
  if (!loadingPreviewBtn) return;
  loadingPreviewBtn.disabled = !!busy;
  loadingPreviewBtn.classList.toggle('is-busy', !!busy);
  loadingPreviewBtn.setAttribute('aria-busy', busy ? 'true' : 'false');
  const spin = $('loadingPreviewSpin');
  const lab = $('loadingPreviewLabel');
  if (spin) spin.hidden = !busy;
  if (lab) lab.textContent = label || (busy ? '生成中…' : 'Loading 页预览');
}

$('taskToastClose')?.addEventListener('click', () => hideTaskToast());

function bp(path) {
  return typeof window.__artistPreviewUrl === 'function'
    ? window.__artistPreviewUrl(path)
    : path;
}

async function api(path, opts) {
  const res = await fetch(bp(path), opts);
  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = typeof body === 'object' ? body.error || JSON.stringify(body) : body;
    throw new Error(err || res.statusText);
  }
  return body;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** 整页进入编辑器，禁止 iframe 套嵌 */
function editorUrlFor(id) {
  return bp(`/editor/?job=${encodeURIComponent(id)}&v=11`);
}

function goEditor(id) {
  location.href = editorUrlFor(id);
}

async function refreshHealth() {
  try {
    const h = await api('/api/health');
    healthEl.textContent = h.milestone || 'ok';
    healthEl.title = h.jobsRoot || '';
  } catch (e) {
    healthEl.textContent = 'offline';
    healthEl.title = e.message;
  }
}

function renderJobs(jobs) {
  if (!jobs.length) {
    jobsEl.textContent = '暂无稿件 — 点右上角导入';
    return;
  }
  jobsEl.innerHTML = '';
  for (const j of jobs) {
    const row = document.createElement('div');
    row.className = 'job-item' + (j.id === currentId ? ' active' : '');
    row.innerHTML = `
      <div style="min-width:0">
        <div class="name">${escapeHtml(j.originalName || j.id)}</div>
        <div class="sub">${escapeHtml(j.id.slice(0, 8))} · ${formatBytes(j.size)}</div>
      </div>
      <span class="badge ${j.status}">${escapeHtml(j.status)}</span>
    `;
    row.addEventListener('click', () => {
      if (j.status === 'edit_ready') goEditor(j.id);
      else selectJob(j.id);
    });
    row.addEventListener('dblclick', () => {
      if (j.status === 'edit_ready') goEditor(j.id);
    });
    jobsEl.appendChild(row);
  }
}

async function refreshJobs() {
  const data = await api('/api/jobs');
  renderJobs(data.jobs || []);
}

function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startPollIfNeeded(status) {
  stopPoll();
  if (status === 'uploaded' || status === 'parsing') {
    pollTimer = setInterval(() => {
      if (currentId) selectJob(currentId, { quiet: true });
    }, 2000);
  }
}

function setHero(title, hint) {
  stageTitle.textContent = title;
  stageHint.innerHTML = hint;
}

async function selectJob(id, { quiet = false, autoEnter = false } = {}) {
  currentId = id;
  const j = await api(`/api/jobs/${id}`);
  currentJob = j;

  if (autoEnter && j.status === 'edit_ready') {
    goEditor(j.id);
    return;
  }

  currentEl.hidden = false;
  currentEl.classList.remove('empty');
  currentEl.innerHTML = `
    <dl>
      <dt>名称</dt><dd>${escapeHtml(j.originalName)}</dd>
      <dt>尺寸</dt><dd>${
        j.canvasWidth && j.canvasHeight
          ? `${j.canvasWidth} × ${j.canvasHeight}`
          : '解析后可见'
      }</dd>
      <dt>切图</dt><dd>${
        j.tileCount != null ? `${j.tileCount} tiles${j.truncated ? ' · truncated' : ''}` : '—'
      }</dd>
      <dt>体积</dt><dd>${formatBytes(j.size)}</dd>
      <dt>状态</dt><dd>${escapeHtml(j.status)} / ${escapeHtml(j.stage || '')}</dd>
      <dt>错误</dt><dd>${j.error ? escapeHtml(j.error) : '—'}</dd>
    </dl>
  `;
  currentActions.hidden = false;
  psdLink.href = j.psdUrl;
  previewLink.href = bp(`/preview/${j.id}/`);
  editorLink.href = editorUrlFor(j.id);
  setLoadingLink(bp(`/preview/${j.id}/loading/`), false);

  try {
    const lp = await api(`/api/jobs/${id}/loading-preview`);
    if (lp.status === 'ready' && lp.previewUrl) {
      setLoadingLink(bp(`/preview/${id}/loading/`), true);
    } else if (lp.status === 'running' || lp.status === 'queued') {
      logStatus(`loading-preview ${lp.status}…`);
    }
  } catch {
    /* optional endpoint */
  }

  if (j.status === 'edit_ready') {
    setHero(j.originalName, '切图就绪 — 点击下方按钮或列表项，<strong>整页打开</strong>图层编辑器');
    editorLink.classList.add('primary');
  } else if (j.status === 'parsing' || j.status === 'uploaded') {
    setHero('解析中…', '完成后会自动进入图层编辑器');
  } else if (j.status === 'failed') {
    setHero('解析失败', escapeHtml(j.error || '可点重新解析'));
  } else {
    setHero(j.originalName || '已选中', escapeHtml(j.status));
  }

  try {
    logsEl.textContent = await api(`/api/jobs/${id}/logs`);
  } catch {
    logsEl.textContent = '(logs unavailable)';
  }
  await refreshJobs();
  startPollIfNeeded(j.status);
  if (!quiet) logStatus(`job ${j.id.slice(0, 8)}… ${j.status}`);
}

async function uploadFile(file) {
  if (!file || uploading) return;
  uploading = true;
  setHero('上传中…', `${file.name} · ${formatBytes(file.size)}`);
  logStatus(`uploading… ${file.name}`);
  try {
    const fd = new FormData();
    fd.append('file', file, file.name);
    const j = await api('/api/jobs', { method: 'POST', body: fd });
    logStatus(`uploaded → ${j.id}`);
    fileInput.value = '';
    await selectJob(j.id);
    const waitReady = setInterval(async () => {
      try {
        const cur = await api(`/api/jobs/${j.id}`);
        if (cur.status === 'edit_ready') {
          clearInterval(waitReady);
          goEditor(j.id);
        } else if (cur.status === 'failed') {
          clearInterval(waitReady);
          await selectJob(j.id);
        }
      } catch {
        /* ignore */
      }
    }, 2000);
  } catch (e) {
    logStatus(`upload failed: ${e.message}`);
    setHero('上传失败', escapeHtml(e.message));
    fileInput.value = '';
  } finally {
    uploading = false;
  }
}

fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  if (f) uploadFile(f);
});

['dragenter', 'dragover'].forEach((ev) => {
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    if (!uploading) drop.classList.add('drag');
  });
});
['dragleave', 'drop'].forEach((ev) => {
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.remove('drag');
  });
});
drop.addEventListener('drop', (e) => {
  if (uploading) return;
  const f = e.dataTransfer?.files?.[0];
  if (f) uploadFile(f);
});

refreshBtn.addEventListener('click', () => {
  refreshJobs().catch((e) => logStatus(e.message));
});

parseBtn.addEventListener('click', async () => {
  if (!currentId) return;
  try {
    const maxTiles = currentJob && currentJob.size > 80 * 1024 * 1024 ? 120 : undefined;
    await api(`/api/jobs/${currentId}/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(maxTiles ? { maxTiles } : {}),
    });
    logStatus(`parse re-queued${maxTiles ? ` (maxTiles=${maxTiles})` : ''}`);
    await selectJob(currentId);
  } catch (e) {
    logStatus(`parse: ${e.message}`);
  }
});

convertBtn.addEventListener('click', async () => {
  if (!currentId) return;
  try {
    await api(`/api/jobs/${currentId}/convert`, { method: 'POST' });
  } catch (e) {
    logStatus(`convert: ${e.message}`);
  }
});

function openPreviewUrl(pathUrl) {
  const run = (href) => {
    try {
      const a = document.createElement('a');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      return true;
    } catch {
      try {
        return !!window.open(href, '_blank', 'noopener');
      } catch {
        return false;
      }
    }
  };
  const abs =
    typeof window.__artistPreviewAbsoluteUrl === 'function'
      ? window.__artistPreviewAbsoluteUrl(pathUrl)
      : pathUrl;
  if (abs && /^https?:\/\//i.test(abs)) return run(abs);
  return run(pathUrl);
}

async function offerLoadingQr(pathUrl) {
  setLoadingLink(pathUrl, true);
  if (typeof window.showPreviewQr === 'function') {
    try {
      await window.showPreviewQr(pathUrl, 'Loading 手机预览');
    } catch {
      /* ignore */
    }
  }
}

loadingQrBtn?.addEventListener('click', () => {
  const url = loadingQrBtn.dataset.url || loadingPreviewLink?.getAttribute('href');
  if (!url || url === '#') {
    showTaskToast('请先生成 Loading 预览', {
      kind: 'error',
      hideSpin: true,
      autoHideMs: 3000,
    });
    return;
  }
  if (typeof window.showPreviewQr === 'function') {
    window.showPreviewQr(url, 'Loading 手机预览');
  }
});

loadingPreviewBtn?.addEventListener('click', async () => {
  if (!currentId) {
    showTaskToast('请先选择稿件', { kind: 'error', hideSpin: true, autoHideMs: 3000 });
    return;
  }
  if (loadingPreviewBtn.disabled) return;
  stopLoadingPoll();
  const pathUrl = bp(`/preview/${currentId}/loading/`);
  setLoadingPreviewBusy(true, '检查中…');
  showTaskToast('检查 Loading 预览缓存…');
  logStatus('loading-preview…');
  try {
    const started = await api(`/api/jobs/${currentId}/loading-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: true }),
    });
    if (started.status === 'ready' || started.cached) {
      setLoadingPreviewBusy(false);
      const opened = openPreviewUrl(pathUrl);
      await offerLoadingQr(pathUrl);
      logStatus(
        started.cached
          ? `loading-preview cache → ${pathUrl}`
          : `loading-preview ready → ${pathUrl}`,
      );
      showTaskToast(
        opened
          ? 'Loading 已就绪：桌面已打开，可扫码手机预览'
          : `预览已就绪，请扫码或点「打开 Loading」`,
        {
          kind: 'ok',
          hideSpin: true,
          autoHideMs: 4000,
        },
      );
      return;
    }
    setLoadingPreviewBusy(true, '生成中…');
    showTaskToast('正在生成 Loading H5，请稍候…');
    const pollOnce = async () => {
      const st = await api(`/api/jobs/${currentId}/loading-preview`);
      if (st.status === 'ready') {
        stopLoadingPoll();
        setLoadingPreviewBusy(false);
        const opened = openPreviewUrl(pathUrl);
        await offerLoadingQr(pathUrl);
        logStatus(`loading-preview ready → ${pathUrl}`);
        showTaskToast(
          opened
            ? 'Loading 已就绪：桌面已打开，可扫码手机预览'
            : '预览已就绪，请扫码或点「打开 Loading」',
          {
            kind: 'ok',
            hideSpin: true,
            autoHideMs: 4000,
          },
        );
      } else if (st.status === 'error') {
        stopLoadingPoll();
        setLoadingPreviewBusy(false);
        const err = st.error || 'failed';
        logStatus(`loading-preview error: ${err}`);
        showTaskToast(`生成失败：${err}`, {
          kind: 'error',
          hideSpin: true,
          autoHideMs: 8000,
        });
      } else {
        const phase = st.status || 'running';
        setLoadingPreviewBusy(true, phase === 'queued' ? '排队中…' : '生成中…');
        logStatus(`loading-preview ${phase}…`);
        showTaskToast(
          phase === 'queued' ? '已入队，等待开始…' : '正在生成 Loading H5…',
        );
      }
    };
    await pollOnce();
    loadingPollTimer = setInterval(() => {
      pollOnce().catch((e) => {
        stopLoadingPoll();
        setLoadingPreviewBusy(false);
        logStatus(`loading-preview poll: ${e.message}`);
        showTaskToast(`轮询失败：${e.message}`, {
          kind: 'error',
          hideSpin: true,
          autoHideMs: 6000,
        });
      });
    }, 2000);
  } catch (e) {
    setLoadingPreviewBusy(false);
    logStatus(`loading-preview: ${e.message}`);
    showTaskToast(`无法启动：${e.message}`, {
      kind: 'error',
      hideSpin: true,
      autoHideMs: 8000,
    });
  }
});

editorLink.addEventListener('click', (e) => {
  if (!currentId) return;
  e.preventDefault();
  goEditor(currentId);
});

refreshHealth();
refreshJobs().catch((e) => logStatus(e.message));
setInterval(refreshHealth, 15000);
