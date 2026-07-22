#!/usr/bin/env node
'use strict';

/**
 * TTF font importer loop:
 *   1. copy a system TTF into assets/fonts/probefont.ttf (no .meta)
 *   2. container importer generates .meta + library TTFFont JSON + <uuid>/<name>.ttf
 *   3. browser loadAny({uuid}) resolves cc.TTFFont with a registered
 *      @font-face family ("probefont_LABEL")
 * `--cleanup` removes the test files.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PROJECT = 'd:/tempWorkspace/baseAIAutoCocos';
const ASSETS = path.join(PROJECT, 'assets');
const FONT_DIR = path.join(ASSETS, 'fonts');
const TTF = path.join(FONT_DIR, 'probefont.ttf');
const SRC_TTF = 'C:\\Windows\\Fonts\\arial.ttf';
const URL = 'http://127.0.0.1:7460/?autoReload=false';

async function waitFor(desc, fn, timeoutMs = 20000, stepMs = 500) {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${desc}`);
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

if (process.argv.includes('--cleanup')) {
  for (const f of [TTF, TTF + '.meta']) {
    try { fs.unlinkSync(f); console.log('[e2e-font] removed', path.relative(PROJECT, f)); } catch {}
  }
  try { fs.rmdirSync(FONT_DIR); } catch {}
  process.exit(0);
}

(async () => {
  fs.mkdirSync(FONT_DIR, { recursive: true });
  fs.writeFileSync(TTF, fs.readFileSync(SRC_TTF));
  console.log('[e2e-font] wrote', path.relative(PROJECT, TTF));

  const meta = await waitFor('probefont.ttf.meta from container importer', () => {
    try { return JSON.parse(fs.readFileSync(TTF + '.meta', 'utf8')); } catch { return null; }
  });
  console.log('[e2e-font] imported, uuid =', meta.uuid);
  await waitFor('library TTFFont json + native', () => {
    const dir = path.join(PROJECT, 'library', meta.uuid.slice(0, 2));
    return (
      fs.existsSync(path.join(dir, `${meta.uuid}.json`)) &&
      fs.existsSync(path.join(dir, meta.uuid, 'probefont.ttf'))
    );
  });

  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction(
    () => !!(globalThis.cc && globalThis.__HEADLESS_PROBE__),
    { timeout: 90000 },
  );

  const result = await page.evaluate((uuid) => new Promise((resolve) => {
    globalThis.cc.assetManager.loadAny({ uuid }, (err, font) => {
      if (err) {
        resolve({ ok: false, error: String(err.message || err) });
        return;
      }
      resolve({
        ok: true,
        type: font?.constructor?.name,
        name: font?.name,
        fontFamily: font?._fontFamily,
        native: font?._native,
      });
    });
  }), meta.uuid);
  await browser.close();

  console.log('[e2e-font] result:', JSON.stringify(result));
  if (errors.length) console.log('[e2e-font] console errors:', errors.slice(0, 5));
  if (result.ok && result.type === 'TTFFont' && /probefont/.test(result.fontFamily || '')) {
    console.log('[e2e-font] SUCCESS — TTF → auto import → browser TTFFont, family =', result.fontFamily);
  } else {
    console.log('[e2e-font] FAIL');
    process.exit(1);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
