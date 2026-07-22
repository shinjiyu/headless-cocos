const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  const logs = [];
  const bad = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => bad.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => {
    if (r.status() >= 400) bad.push(`[${r.status()}] ${r.url()}`);
  });

  await page.goto('http://127.0.0.1:7460/?autoReload=false', {
    waitUntil: 'networkidle2',
    timeout: 120000,
  });
  await new Promise((r) => setTimeout(r, 15000));

  const state = await page.evaluate(() => ({
    hasCC: !!globalThis.cc,
    probe: !!globalThis.__HEADLESS_PROBE__,
    hasSystem: !!globalThis.System,
    frames: Array.from(document.querySelectorAll('iframe')).map((f) => f.src),
    bodySnippet: document.body ? document.body.innerHTML.slice(0, 400) : null,
  }));
  const frames = page.frames().map((f) => f.url());
  let frameState = null;
  const gameFrame = page.frames().find((f) => f !== page.mainFrame());
  if (gameFrame) {
    try {
      frameState = await gameFrame.evaluate(() => ({
        hasCC: !!globalThis.cc,
        probe: !!globalThis.__HEADLESS_PROBE__,
        sceneName: globalThis.cc?.director?.getScene?.()?.name ?? null,
      }));
    } catch (e) {
      frameState = String(e);
    }
  }

  console.log(JSON.stringify({ state, frames, frameState, bad, logs: logs.slice(-60) }, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
