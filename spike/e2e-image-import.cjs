const fs = require('fs');
const puppeteer = require('puppeteer-core');

const ASSET = 'D:/tempWorkspace/baseAIAutoCocos/assets/importer-e2e/probe.png';
const IMAGE_40 = 'C:/ProgramData/cocos/editors/Creator/3.8.8/resources/resources/3d/engine/editor/assets/default_ui/default_btn_normal.png';
const IMAGE_31 = 'C:/ProgramData/cocos/editors/Creator/3.8.8/resources/resources/3d/engine/editor/assets/default_ui/atom.png';
const SPRITE_FRAME_UUID = '125c0e17-5da1-4dde-937c-52783d940de0@f9941';
let browser;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(fn, timeout = 90000) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeout) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (err) {
      lastError = err;
    }
    await delay(500);
  }
  throw lastError || new Error('waitFor timeout');
}

async function loadSpriteFrame(page) {
  return page.evaluate(async (uuid) => {
    if (!globalThis.cc?.assetManager) return null;
    return new Promise((resolve, reject) => {
      globalThis.cc.assetManager.loadAny({ uuid }, (err, asset) => {
        if (err) {
          reject(new Error(String(err)));
          return;
        }
        resolve({
          type: asset?.constructor?.name,
          name: asset?.name,
          width: asset?.rect?.width,
          height: asset?.rect?.height,
          textureWidth: asset?.texture?.width,
          textureHeight: asset?.texture?.height,
        });
      });
    });
  }, SPRITE_FRAME_UUID);
}

(async () => {
  // Known initial bytes; importer should already have produced 40x40 outputs.
  await fs.promises.copyFile(IMAGE_40, ASSET);
  await delay(4000);

  browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  page.on('console', (msg) => {
    if (/HeadlessProbe|image|asset/i.test(msg.text())) console.log('[chrome]', msg.text());
  });
  page.on('pageerror', (err) => console.error('[chrome:error]', err.message));

  await page.goto('http://127.0.0.1:7460/', {
    waitUntil: 'networkidle2',
    timeout: 180000,
  });

  const before = await waitFor(() => loadSpriteFrame(page));
  console.log('[e2e-image] before:', JSON.stringify(before));
  if (before.width !== 40 || before.height !== 40) {
    throw new Error(`expected 40x40 SpriteFrame, got ${before.width}x${before.height}`);
  }

  console.log('[e2e-image] replace host PNG 40x40 -> 31x31');
  await fs.promises.copyFile(IMAGE_31, ASSET);

  // HMR reload destroys the old runtime and asset cache. Repeated evaluation
  // naturally retries through the navigation window until the new runtime is up.
  const after = await waitFor(async () => {
    const value = await loadSpriteFrame(page);
    return value?.width === 31 && value?.height === 31 ? value : null;
  });
  console.log('[e2e-image] after:', JSON.stringify(after));

  // Leave fixture in its documented 40x40 state.
  await fs.promises.copyFile(IMAGE_40, ASSET);
  console.log('[e2e-image] SUCCESS — host edit → Docker import → HMR → browser asset');
  await browser.close();
})().catch(async (err) => {
  try { await fs.promises.copyFile(IMAGE_40, ASSET); } catch {}
  try { await browser?.close(); } catch {}
  console.error('[e2e-image] FAIL', err?.stack || err);
  process.exitCode = 1;
});
