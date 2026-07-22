// E2E test: mini asset-db sync path
// - Open browser, assert scene has a node named "Canvas"
// - Edit assets/scene/PreviewBoot.scene: rename Canvas → MiniAssetDBWorks
// - Wait for reload; assert new name shows up
// - Restore

const puppeteer = require('puppeteer-core');
const fs = require('fs');

const SCENE = 'D:/tempWorkspace/baseAIAutoCocos/assets/scene/PreviewBoot.scene';

async function readCanvasName(page) {
  return page.evaluate(() => {
    try {
      const scene = globalThis.cc?.director?.getScene();
      if (!scene) return null;
      const names = [];
      const walk = (n) => {
        for (const c of (n.children || [])) {
          names.push(c.name);
          walk(c);
        }
      };
      walk(scene);
      return names;
    } catch (e) { return { err: String(e) }; }
  });
}

async function waitFor(fn, { timeout = 25000, interval = 400 } = {}) {
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
  const original = 'Canvas';
  const renamed = 'MiniAssetDBWorks';

  // Reset scene to known state first
  let src0 = await fs.promises.readFile(SCENE, 'utf8');
  if (src0.includes(`"_name": "${renamed}"`)) {
    src0 = src0.replace(`"_name": "${renamed}"`, `"_name": "${original}"`);
    await fs.promises.writeFile(SCENE, src0, 'utf8');
    console.log(`[e2e-scene] reset Canvas name to ${original}`);
    await new Promise((r) => setTimeout(r, 2000));
  }

  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[chrome:err]', e.message));

  console.log('[e2e-scene] navigate');
  await page.goto('http://127.0.0.1:7460/', { waitUntil: 'networkidle2', timeout: 120000 });
  await new Promise((r) => setTimeout(r, 12000));

  const names0 = await readCanvasName(page);
  console.log('[e2e-scene] before edit, children:', JSON.stringify(names0));
  if (!Array.isArray(names0) || !names0.includes(original)) {
    throw new Error(`expected scene to contain "${original}", got ${JSON.stringify(names0)}`);
  }

  console.log('[e2e-scene] editing scene: rename Canvas →', renamed);
  const before = await fs.promises.readFile(SCENE, 'utf8');
  const after = before.replace(`"_name": "${original}"`, `"_name": "${renamed}"`);
  if (before === after) throw new Error('scene had no Canvas to rename');
  await fs.promises.writeFile(SCENE, after, 'utf8');

  console.log('[e2e-scene] waiting for browser to show new name');
  const names1 = await waitFor(async () => {
    const n = await readCanvasName(page);
    if (Array.isArray(n) && n.includes(renamed)) return n;
    return null;
  }, { timeout: 30000, interval: 500 });
  console.log('[e2e-scene] after edit, children:', JSON.stringify(names1));

  // Restore
  await fs.promises.writeFile(SCENE, before, 'utf8');
  console.log('[e2e-scene] SUCCESS — scene edit via mini asset-db confirmed');
  await browser.close();
  process.exit(0);
})().catch((e) => {
  console.error('[e2e-scene] FAIL', e.message);
  process.exit(1);
});
