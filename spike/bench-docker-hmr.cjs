#!/usr/bin/env node
'use strict';

/**
 * Benchmark: host asset edit → Docker preview-mirror update (TS / mini-packer).
 *
 * Primary wall clock: edit → chunk contains new PROBE_VERSION (servable).
 * Stages reconstructed from `docker logs -t` timestamps after the fact.
 *
 *   node spike/bench-docker-hmr.cjs
 *   node spike/bench-docker-hmr.cjs --runs 5
 */

const { spawnSync } = require('child_process');
const fs = require('fs');

const CONTAINER = process.env.DOCKER_PREVIEW || argVal('--container') || 'cocos-preview';
const RUNS = Math.max(1, Number(argVal('--runs') || 5));
const PROBE_TS =
  process.env.PROBE_TS ||
  'D:/tempWorkspace/baseAIAutoCocos/assets/scripts/HeadlessProbe.ts';
const CHUNK =
  '/workspace/temp/programming/packer-driver/targets/preview-mini/chunks/7d/7d0661b2ee33e4b885a478dbc38c7441b8df4bbf.js';

function argVal(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

function docker(args) {
  return spawnSync('docker', args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

function dockerExec(cmd) {
  const r = docker(['exec', CONTAINER, 'sh', '-c', cmd]);
  if (r.status !== 0) throw new Error(`docker exec failed: ${r.stderr || r.stdout || r.status}`);
  return r.stdout || '';
}

function sleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* spin */ }
}

function median(arr) {
  const a = [...arr].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function summarize(name, samples) {
  const xs = samples.filter((x) => x != null && Number.isFinite(x));
  if (!xs.length) return `${name}: n/a`;
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  const avg = xs.reduce((s, x) => s + x, 0) / xs.length;
  return `${name}: med=${median(xs).toFixed(0)}ms avg=${avg.toFixed(0)}ms [${min}..${max}] n=${xs.length}`;
}

function readProbeVersion() {
  const m = fs.readFileSync(PROBE_TS, 'utf8').match(/PROBE_VERSION\s*=\s*(\d+)/);
  if (!m) throw new Error('PROBE_VERSION not found');
  return Number(m[1]);
}

function writeProbeVersion(v) {
  const src = fs.readFileSync(PROBE_TS, 'utf8');
  const next = src.replace(/PROBE_VERSION\s*=\s*\d+/, `PROBE_VERSION = ${v}`);
  if (next === src) throw new Error(`failed to set PROBE_VERSION=${v}`);
  fs.writeFileSync(PROBE_TS, next, 'utf8');
}

function chunkHasVersion(v) {
  const out = dockerExec(`grep -o 'PROBE_VERSION = ${v}' '${CHUNK}' || true`);
  return out.includes(`PROBE_VERSION = ${v}`);
}

function lastBuildNum() {
  const r = docker(['logs', CONTAINER, '--tail', '200']);
  const log = `${r.stdout || ''}${r.stderr || ''}`;
  let n = 0;
  const re = /\[mini\] build#(\d+)/g;
  let m;
  while ((m = re.exec(log))) n = Math.max(n, Number(m[1]));
  return n;
}

/** Parse `docker logs -t` lines into { t, line } with Date ms. */
function timestampedLogsSince(isoSince) {
  const r = docker(['logs', CONTAINER, '-t', '--since', isoSince]);
  const raw = `${r.stdout || ''}${r.stderr || ''}`;
  const rows = [];
  for (const line of raw.split(/\r?\n/)) {
    // 2026-07-22T08:16:50.123456789Z message
    const m = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s+(.*)$/);
    if (!m) continue;
    rows.push({ t: Date.parse(m[1]), line: m[2] });
  }
  return rows;
}

function ensureContainer() {
  const r = docker(['inspect', '-f', '{{.State.Running}}', CONTAINER]);
  if (r.status !== 0 || String(r.stdout).trim() !== 'true') {
    throw new Error(`container ${CONTAINER} is not running`);
  }
  const st = dockerExec('wget -qO- http://127.0.0.1:7460/__hmr/status || true');
  if (!st.includes('"watch"')) throw new Error(`mirror not healthy: ${st}`);
}

function oneRun(fromV, toV) {
  if (!chunkHasVersion(fromV)) {
    writeProbeVersion(fromV);
    const tSettle = Date.now();
    while (!chunkHasVersion(fromV)) {
      if (Date.now() - tSettle > 60000) throw new Error(`settle to ${fromV} timeout`);
      sleep(200);
    }
    sleep(1000);
  }

  const beforeNum = lastBuildNum();
  const isoSince = new Date().toISOString();
  sleep(30);

  const t0 = Date.now();
  writeProbeVersion(toV);

  // Primary: wait until chunk is updated (what preview can serve).
  let chunkMs = null;
  while (Date.now() - t0 < 60000) {
    if (chunkHasVersion(toV)) {
      chunkMs = Date.now() - t0;
      break;
    }
    sleep(120);
  }
  if (chunkMs == null) throw new Error('chunk update timeout');

  // Reconstruct stages from timestamped logs.
  sleep(300); // let HMR debounce flush
  const rows = timestampedLogsSince(isoSince);
  let detectMs = null;
  let packerMs = null;
  let buildDoneMs = null;
  let hmrMs = null;
  let buildNum = null;

  for (const { t, line } of rows) {
    if (t < t0 - 50) continue;
    const start = line.match(/\[mini\] build#(\d+) start \([^\n]*HeadlessProbe/);
    if (start) {
      const n = Number(start[1]);
      if (n > beforeNum) {
        buildNum = n;
        detectMs = t - t0;
      }
    }
    if (buildNum != null) {
      const ok = line.match(new RegExp(`\\[mini\\] build#${buildNum} ok in (\\d+)ms`));
      if (ok) {
        packerMs = Number(ok[1]);
        buildDoneMs = t - t0;
      }
      if (/\[hmr\] browser:reload mini:.*HeadlessProbe/.test(line)) {
        hmrMs = t - t0;
      }
    }
  }

  return { detectMs, packerMs, buildDoneMs, chunkMs, hmrMs };
}

(async () => {
  console.log(`[bench] container=${CONTAINER} runs=${RUNS}`);
  console.log(`[bench] probe=${PROBE_TS}`);
  console.log('[bench] knobs: WATCH_POLL_MS=800 BUILD_DEBOUNCE=150 RELOAD_DEBOUNCE=400');
  ensureContainer();

  let cur = readProbeVersion();
  const samples = [];

  for (let i = 0; i < RUNS; i++) {
    const next = cur + 1;
    console.log(`\n[bench] run ${i + 1}/${RUNS}: ${cur} → ${next}`);
    const r = oneRun(cur, next);
    samples.push(r);
    console.log(
      `  detect=${r.detectMs}ms  packer=${r.packerMs}ms  buildDone=${r.buildDoneMs}ms  chunk=${r.chunkMs}ms  hmr=${r.hmrMs}ms`,
    );
    cur = next;
    sleep(400);
  }

  writeProbeVersion(5);
  const tRest = Date.now();
  while (!chunkHasVersion(5) && Date.now() - tRest < 60000) sleep(200);

  console.log('\n=== Docker host TS edit → preview update ===');
  console.log(summarize('A. poll detect → build start', samples.map((s) => s.detectMs)));
  console.log(summarize('B. packer compile (self-report)', samples.map((s) => s.packerMs)));
  console.log(summarize('C. edit → build ok (log ts)', samples.map((s) => s.buildDoneMs)));
  console.log(summarize('D. edit → chunk servable  ★', samples.map((s) => s.chunkMs)));
  console.log(summarize('E. edit → HMR broadcast', samples.map((s) => s.hmrMs)));
  console.log(
    '\n★ D is the practical "preview can fetch new JS" latency.\n' +
      'Browser reload/paint adds ~RELOAD_DEBOUNCE(400ms) + page load (often 0.5–2s) if a client is connected.\n' +
      'Non-TS assets (prefab/scene JSON) skip packer — typically detect + library sync + HMR only.',
  );
})().catch((err) => {
  console.error('[bench] FAIL', err);
  process.exit(1);
});
