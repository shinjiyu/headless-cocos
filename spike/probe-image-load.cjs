const puppeteer = require('puppeteer-core');

const UUID = '125c0e17-5da1-4dde-937c-52783d940de0';
const SF = `${UUID}@f9941`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  page.on('response', async (r) => {
    if (/125c0e17|query-extname/.test(r.url())) {
      logs.push(`[http ${r.status()}] ${r.url()}`);
    }
  });

  await page.goto('http://127.0.0.1:7460/?autoReload=false', {
    waitUntil: 'networkidle2',
    timeout: 180000,
  });
  await page.waitForFunction(
    () => !!(globalThis.cc && globalThis.cc.assetManager && globalThis.__HEADLESS_PROBE__),
    { timeout: 90000 },
  );
  await new Promise((r) => setTimeout(r, 2000));

  const result = await page.evaluate(async (baseUuid, sfUuid) => {
    const out = {
      hasCC: !!globalThis.cc,
      mainConfig: null,
      queryExt: null,
      loadSf: null,
      loadBase: null,
    };
    try {
      const cfg = await (await fetch('/assets/main/config.json')).json();
      out.mainConfig = {
        hasBase: cfg.uuids?.includes(baseUuid),
        hasSf: cfg.uuids?.includes(sfUuid),
        pngMap: cfg.extensionMap?.['.png']?.includes(baseUuid),
        path: cfg.paths?.[sfUuid],
      };
    } catch (e) {
      out.mainConfig = String(e);
    }
    try {
      out.queryExt = await (await fetch(`/query-extname/${baseUuid}`)).text();
    } catch (e) {
      out.queryExt = String(e);
    }

    const load = (uuid) =>
      new Promise((resolve) => {
        globalThis.cc.assetManager.loadAny({ uuid }, (err, asset) => {
          if (err) {
            resolve({ ok: false, error: String(err && err.message || err) });
            return;
          }
          resolve({
            ok: true,
            type: asset?.constructor?.name,
            name: asset?.name,
            width: asset?.rect?.width ?? asset?.width,
            height: asset?.rect?.height ?? asset?.height,
            nativeUrl: asset?.nativeUrl,
            _native: asset?._native,
            textureW: asset?.texture?.width,
            textureH: asset?.texture?.height,
            imageW: asset?.texture?.image?.width,
            imageH: asset?.texture?.image?.height,
          });
        });
      });

    out.loadSf = await load(sfUuid);
    out.loadBase = await load(baseUuid);
    return out;
  }, UUID, SF);

  console.log(JSON.stringify({ result, logs: logs.slice(-40) }, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
