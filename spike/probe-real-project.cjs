#!/usr/bin/env node
'use strict';

/**
 * Exploratory probe: load the real project (proj-l-client-mcjb) in the
 * headless preview and report everything that goes wrong — console errors,
 * failed requests, engine boot state, scene content. Takes a screenshot.
 */

const path = require('path');
const puppeteer = require('puppeteer-core');

const URL = process.env.PROBE_URL || 'http://127.0.0.1:7461/?autoReload=false';
const SCREENSHOT = path.join(__dirname, 'probe-real-project.png');
const SETTLE_MS = Number(process.env.SETTLE_MS || 8000);

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  const consoleMsgs = [];
  const failedReqs = [];
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error' || t === 'warn') consoleMsgs.push([t, m.text().slice(0, 500)]);
  });
  page.on('pageerror', (e) => consoleMsgs.push(['pageerror', String(e).slice(0, 500)]));
  page.on('response', (r) => {
    if (r.status() >= 400) failedReqs.push([r.status(), r.url()]);
  });

  console.log('[probe] goto', URL);
  try {
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 180000 });
  } catch (e) {
    console.log('[probe] goto error:', e.message);
  }

  let engineUp = false;
  try {
    await page.waitForFunction(
      () => !!(globalThis.cc && globalThis.cc.director?.getScene?.()),
      { timeout: 90000 },
    );
    engineUp = true;
  } catch {
    console.log('[probe] engine did not reach a scene within 90s');
  }

  await new Promise((r) => setTimeout(r, SETTLE_MS));

  const state = await page.evaluate(() => {
    const cc = globalThis.cc;
    if (!cc) return { cc: false };
    const scene = cc.director?.getScene?.();
    const walk = (n, depth) => {
      if (!n || depth > 3) return null;
      return {
        name: n.name,
        active: n.active,
        components: (n.components || []).map((c) => c.constructor?.name),
        children: depth >= 3 ? (n.children || []).length : (n.children || []).map((c) => walk(c, depth + 1)),
      };
    };
    return {
      cc: true,
      sceneName: scene?.name ?? null,
      tree: scene ? walk(scene, 0) : null,
      bundles: (() => {
        const names = [];
        cc.assetManager.bundles.forEach((b) => names.push(b.name));
        return names;
      })(),
      assetCount: (() => { let n = 0; cc.assetManager.assets.forEach(() => n++); return n; })(),
    };
  }).catch((e) => ({ evalError: String(e).slice(0, 300) }));

  await page.screenshot({ path: SCREENSHOT });
  await browser.close();

  console.log('\n[probe] engine up:', engineUp);
  console.log('[probe] state:', JSON.stringify(state, null, 2).slice(0, 4000));
  console.log('\n[probe] failed requests (' + failedReqs.length + '):');
  const seen = new Set();
  for (const [s, u] of failedReqs) {
    const key = s + ' ' + u.replace(/[0-9a-f-]{36}/g, '<uuid>');
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(' ', s, u);
  }
  console.log('\n[probe] console errors/warnings (' + consoleMsgs.length + '):');
  const seenMsg = new Set();
  for (const [t, m] of consoleMsgs) {
    const key = m.slice(0, 120);
    if (seenMsg.has(key)) continue;
    seenMsg.add(key);
    console.log(' ', t.toUpperCase() + ':', m.replace(/\n/g, ' | ').slice(0, 300));
  }
  console.log('\n[probe] screenshot:', SCREENSHOT);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
