#!/usr/bin/env node
'use strict';

/**
 * Spine 3.8 binary importer loop:
 *   official spine-runtimes/3.8 spineboy-pro.skel + atlas + PNG
 *   → container importer → SkeletonData JSON + <uuid>.bin
 *   → browser native dependency download → wasm binary parser
 *   → sp.Skeleton component + "walk" animation.
 *
 * `--cleanup` removes copied project assets.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PROJECT = 'd:/tempWorkspace/baseAIAutoCocos';
const DIR = path.join(PROJECT, 'assets', 'spine-binary');
const FIXTURE = path.join(__dirname, 'fixtures', 'spine38-binary');
const FILES = ['spineboy-pro.skel', 'spineboy-pro.atlas', 'spineboy-pma.png'];
const URL = 'http://127.0.0.1:7460/?autoReload=false';
const SCREENSHOT = path.join(__dirname, 'e2e-spine-binary.png');

async function waitFor(desc, fn, timeoutMs = 30000, stepMs = 500) {
  const t0 = Date.now();
  for (;;) {
    const value = fn();
    if (value) return value;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${desc}`);
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}

function cleanup() {
  for (const name of FILES) {
    for (const file of [path.join(DIR, name), path.join(DIR, `${name}.meta`)]) {
      try {
        fs.unlinkSync(file);
        console.log('[e2e-spine-bin] removed', path.relative(PROJECT, file));
      } catch {}
    }
  }
  try { fs.rmdirSync(DIR); } catch {}
}

if (process.argv.includes('--cleanup')) {
  cleanup();
  process.exit(0);
}

(async () => {
  cleanup();
  fs.mkdirSync(DIR, { recursive: true });
  for (const name of FILES) {
    fs.copyFileSync(path.join(FIXTURE, name), path.join(DIR, name));
  }
  console.log('[e2e-spine-bin] copied official Spine 3.8 fixture');

  const meta = await waitFor('spineboy-pro.skel.meta', () => {
    try {
      const value = JSON.parse(fs.readFileSync(path.join(DIR, 'spineboy-pro.skel.meta'), 'utf8'));
      return value.importer === 'spine-data' ? value : null;
    } catch {
      return null;
    }
  });

  const libDir = path.join(PROJECT, 'library', meta.uuid.slice(0, 2));
  await waitFor('SkeletonData JSON + binary library products', () => (
    fs.existsSync(path.join(libDir, `${meta.uuid}.json`))
    && fs.existsSync(path.join(libDir, `${meta.uuid}.bin`))
  ));
  const product = JSON.parse(fs.readFileSync(path.join(libDir, `${meta.uuid}.json`), 'utf8'));
  console.log('[e2e-spine-bin] imported uuid =', meta.uuid, 'native =', product._native);

  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 640 });
  const errors = [];
  const requests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.url().includes(meta.uuid)) requests.push([response.status(), response.url()]);
  });

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction(
    () => !!(globalThis.cc && globalThis.__HEADLESS_PROBE__),
    { timeout: 90000 },
  );

  const result = await page.evaluate((uuid) => new Promise((resolve) => {
    const cc = globalThis.cc;
    cc.assetManager.loadAny({ uuid }, (err, data) => {
      if (err) {
        resolve({ ok: false, error: String(err.message || err) });
        return;
      }
      try {
        const runtime = data.getRuntimeData();
        const animations = runtime.animations?.map
          ? runtime.animations.map((animation) => animation.name)
          : Array.from(runtime.animations || [], (animation) => animation.name);
        const node = new cc.Node('BinarySpine');
        const skeleton = node.addComponent('sp.Skeleton');
        skeleton.skeletonData = data;
        skeleton.setAnimation(0, 'walk', true);
        node.setScale(0.5, 0.5, 1);
        cc.director.getScene().getChildByName('Canvas').addChild(node);
        resolve({
          ok: true,
          type: data.constructor?.name,
          native: data._native,
          textures: data.textures?.length,
          textureWidth: data.textures?.[0]?.width,
          bones: runtime.bones?.length ?? runtime.bones?.size,
          animations,
          currentAnimation: skeleton.animation,
          componentAttached: node.parent?.name === 'Canvas',
        });
      } catch (e) {
        resolve({ ok: false, error: String(e.message || e) });
      }
    });
  }), meta.uuid);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await page.screenshot({ path: SCREENSHOT });
  await browser.close();

  console.log('[e2e-spine-bin] result:', JSON.stringify(result, null, 2));
  console.log('[e2e-spine-bin] screenshot:', SCREENSHOT);
  console.log('[e2e-spine-bin] requests:', JSON.stringify(requests));
  if (errors.length) console.log('[e2e-spine-bin] console errors:', errors.slice(0, 8));

  const nativeFetched = requests.some(([status, url]) => status === 200 && url.endsWith(`${meta.uuid}.bin`));
  const passed = result.ok
    && result.type === 'SkeletonData'
    && result.native === '.bin'
    && result.textures === 1
    && result.animations?.includes('walk')
    && result.currentAnimation === 'walk'
    && result.componentAttached
    && nativeFetched;

  console.log('[e2e-spine-bin]', passed ? 'SUCCESS' : 'FAIL');
  if (!passed) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
