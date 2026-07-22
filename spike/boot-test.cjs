const puppeteer = require('puppeteer-core');
const fs = require('fs');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  const bad = [];
  page.on('response', (r) => { if (r.status() >= 400) bad.push({ url: r.url(), status: r.status() }); });
  page.on('console', (msg) => {
    fs.appendFileSync('spike/browser-console.jsonl', JSON.stringify({ type: msg.type(), text: msg.text() }) + '\n');
  });
  page.on('pageerror', (e) =>
    fs.appendFileSync(
      'spike/browser-console.jsonl',
      JSON.stringify({ type: 'pageerror', text: String(e), stack: e && e.stack }) + '\n'
    )
  );
  await page.goto('http://127.0.0.1:7460/?autoReload=false', { waitUntil: 'networkidle2', timeout: 180000 });
  await new Promise((r) => setTimeout(r, 20000));
  const probe = await page.evaluate(() => ({
    probe: globalThis.__HEADLESS_PROBE__,
    hasCC: typeof globalThis.cc !== 'undefined',
    scene: globalThis.cc?.director?.getScene()?.name,
    launchScene: globalThis._CCSettings?.launch?.launchScene,
    settings: !!globalThis._CCSettings,
    errorDisplay: document.querySelector('#error')?.style?.display,
    errorText: document.querySelector('#error')?.innerText?.slice?.(0, 500) || '',
  }));
  fs.writeFileSync('spike/browser-boot.json', JSON.stringify({ probe, bad: bad.slice(0,60), badCount: bad.length }, null, 2));
  console.log(JSON.stringify({ probe, badCount: bad.length, badSample: bad.slice(0,10) }, null, 2));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
