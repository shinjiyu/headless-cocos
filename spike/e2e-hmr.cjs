// Full E2E: verify mini-packer + mirror + HMR autoreload works end-to-end.
// - Open browser (autoreload ENABLED)
// - Assert probe = <before>
// - Edit HeadlessProbe.ts to <after>
// - Wait for HMR reload (broadcast triggers browser reload)
// - Assert probe = <after>

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const PROBE_TS = 'D:/tempWorkspace/baseAIAutoCocos/assets/scripts/HeadlessProbe.ts';

async function readProbe(page) {
  return page.evaluate(() => ({
    probe: globalThis.__HEADLESS_PROBE__,
    hasCC: typeof globalThis.cc !== 'undefined',
    scene: globalThis.cc?.director?.getScene()?.name,
    time: Date.now(),
  }));
}

async function bumpProbeVersion(from, to) {
  const src = await fs.promises.readFile(PROBE_TS, 'utf8');
  const next = src.replace(
    new RegExp(`PROBE_VERSION\\s*=\\s*${from}`),
    `PROBE_VERSION = ${to}`
  );
  if (next === src) throw new Error(`could not find PROBE_VERSION = ${from} in ${PROBE_TS}`);
  await fs.promises.writeFile(PROBE_TS, next, 'utf8');
  console.log(`[e2e] bumped PROBE_VERSION ${from} -> ${to}`);
}

async function waitFor(fn, { timeout = 20000, interval = 300 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const r = await fn();
      if (r) return r;
    } catch {}
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error('waitFor timeout');
}

(async () => {
  const before = 5;
  const after = 6;

  // Reset file to known state first
  const src0 = await fs.promises.readFile(PROBE_TS, 'utf8');
  if (!new RegExp(`PROBE_VERSION\\s*=\\s*${before}`).test(src0)) {
    // reset from whatever version to `before`
    const reset = src0.replace(/PROBE_VERSION\s*=\s*\d+/, `PROBE_VERSION = ${before}`);
    await fs.promises.writeFile(PROBE_TS, reset, 'utf8');
    console.log(`[e2e] reset PROBE_VERSION to ${before}`);
    // give mini-build time to react
    await new Promise((r) => setTimeout(r, 3000));
  }

  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  page.on('console', (m) => {
    if (/HeadlessProbe/.test(m.text())) console.log('[chrome]', m.text());
  });
  page.on('pageerror', (e) => console.error('[chrome:err]', e.message));

  console.log('[e2e] navigate (autoreload ON)');
  await page.goto('http://127.0.0.1:7460/', { waitUntil: 'networkidle2', timeout: 120000 });
  await new Promise((r) => setTimeout(r, 12000));

  const p1 = await readProbe(page);
  console.log('[e2e] before edit:', JSON.stringify(p1));
  if (p1.probe !== before) throw new Error(`expected probe=${before} got ${p1.probe}`);

  console.log('[e2e] editing source');
  await bumpProbeVersion(before, after);

  console.log('[e2e] waiting for probe to become', after);
  const p2 = await waitFor(async () => {
    const p = await readProbe(page);
    if (p.probe === after) return p;
    return null;
  }, { timeout: 30000, interval: 500 });
  console.log('[e2e] after edit:', JSON.stringify(p2));

  // Restore to before to leave the project clean
  await bumpProbeVersion(after, before);
  console.log('[e2e] SUCCESS — headless edit-loop confirmed');

  await browser.close();
  process.exit(0);
})().catch((e) => {
  console.error('[e2e] FAIL', e.message);
  process.exit(1);
});
