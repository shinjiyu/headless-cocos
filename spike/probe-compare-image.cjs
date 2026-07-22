const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (m) => {
    const t = m.text();
    if (/missing|error|Image|Sprite|125c0e17|24c419ea/i.test(t)) logs.push(t);
  });

  await page.goto('http://127.0.0.1:7460/?autoReload=false', {
    waitUntil: 'domcontentloaded',
    timeout: 180000,
  });

  // Wait for cc only — probe may not be needed.
  await page.waitForFunction(() => !!(globalThis.cc && globalThis.cc.assetManager), {
    timeout: 120000,
  });
  await new Promise((r) => setTimeout(r, 3000));

  const result = await page.evaluate(async () => {
    const load = (uuid) =>
      new Promise((resolve) => {
        globalThis.cc.assetManager.loadAny({ uuid }, (err, asset) => {
          if (err) return resolve({ ok: false, err: String(err.message || err) });
          resolve({
            ok: true,
            type: asset?.constructor?.name,
            name: asset?.name,
            w: asset?.rect?.width ?? asset?.width,
            h: asset?.rect?.height ?? asset?.height,
            tw: asset?.texture?.width,
            th: asset?.texture?.height,
            iw: asset?.width,
            ih: asset?.height,
            nativeUrl: asset?.nativeUrl,
          });
        });
      });

    return {
      // Creator internal builtin image — known good format
      internalSf: await load('24c419ea-63a8-4ea1-a9d0-7fc469489bbc@f9941'),
      internalImg: await load('24c419ea-63a8-4ea1-a9d0-7fc469489bbc'),
      // Our headless-imported image
      oursSf: await load('125c0e17-5da1-4dde-937c-52783d940de0@f9941'),
      oursImg: await load('125c0e17-5da1-4dde-937c-52783d940de0'),
    };
  });

  console.log(JSON.stringify({ result, logs }, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
