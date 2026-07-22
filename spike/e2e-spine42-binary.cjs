#!/usr/bin/env node
'use strict';

/**
 * Spine 4.2 runtime-switch loop:
 *   flip project settings/v2/packages/engine.json spine._option → spine-4.2
 *   → mirror rewrites preview import-map (spine-version/instantiate → -4.2)
 *   → official spine-runtimes/4.2 spineboy-pro.skel + atlas + PNG
 *   → importer → SkeletonData JSON + <uuid>.bin
 *   → browser loads 4.2 wasm, parses 4.2 binary, plays "walk".
 *
 * `--cleanup` removes copied assets and restores the project spine setting.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PROJECT = 'd:/tempWorkspace/baseAIAutoCocos';
const ENGINE_JSON = path.join(PROJECT, 'settings/v2/packages/engine.json');
const DIR = path.join(PROJECT, 'assets', 'spine42-binary');
const FIXTURE = path.join(__dirname, 'fixtures', 'spine42-binary');
const FILES = ['spineboy-pro.skel', 'spineboy-pro.atlas', 'spineboy-pma.png'];
const URL = 'http://127.0.0.1:7460/?autoReload=false';
const SCREENSHOT = path.join(__dirname, 'e2e-spine42-binary.png');

function setSpineOption(version) {
  const raw = fs.readFileSync(ENGINE_JSON, 'utf8');
  const next = raw.replace(/"_option":\s*"spine-(?:3\.8|4\.2)"/, `"_option": "spine-${version}"`);
  if (next !== raw) {
    fs.writeFileSync(ENGINE_JSON, next);
    console.log(`[e2e-spine42] project spine option -> spine-${version}`);
  }
  return raw !== next;
}

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
        console.log('[e2e-spine42] removed', path.relative(PROJECT, file));
      } catch {}
    }
  }
  try { fs.rmdirSync(DIR); } catch {}
  setSpineOption('3.8');
}

if (process.argv.includes('--cleanup')) {
  cleanup();
  process.exit(0);
}

(async () => {
  cleanup();
  setSpineOption('4.2');
  fs.mkdirSync(DIR, { recursive: true });
  for (const name of FILES) {
    fs.copyFileSync(path.join(FIXTURE, name), path.join(DIR, name));
  }
  console.log('[e2e-spine42] copied official Spine 4.2 fixture');

  try {
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
    console.log('[e2e-spine42] imported uuid =', meta.uuid);

    const browser = await puppeteer.launch({
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      headless: 'new',
      args: ['--no-sandbox', '--disable-gpu'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 960, height: 640 });
    const errors = [];
    const wasmRequests = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('response', (response) => {
      const url = response.url();
      if (/spine.*(wasm|spine-version|spine-instantiate)/.test(url)) {
        wasmRequests.push([response.status(), url]);
      }
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
          const node = new cc.Node('Spine42');
          const skeleton = node.addComponent('sp.Skeleton');
          skeleton.skeletonData = data;
          skeleton.setAnimation(0, 'walk', true);
          node.setScale(0.5, 0.5, 1);
          cc.director.getScene().getChildByName('Canvas').addChild(node);
          resolve({
            ok: true,
            type: data.constructor?.name,
            native: data._native,
            skeletonVersion: runtime.version || runtime.getVersion?.(),
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

    console.log('[e2e-spine42] result:', JSON.stringify(result, null, 2));
    console.log('[e2e-spine42] screenshot:', SCREENSHOT);
    console.log('[e2e-spine42] spine runtime requests:', JSON.stringify(wasmRequests, null, 1));
    if (errors.length) console.log('[e2e-spine42] console errors:', errors.slice(0, 8));

    const loaded42 = wasmRequests.some(([status, url]) => status === 200 && url.includes('/4.2/'));
    const loaded38 = wasmRequests.some(([, url]) => url.includes('/3.8/'));
    const passed = result.ok
      && result.type === 'SkeletonData'
      && result.native === '.bin'
      && result.animations?.includes('walk')
      && result.currentAnimation === 'walk'
      && result.componentAttached
      && loaded42
      && !loaded38;

    console.log('[e2e-spine42]', passed ? 'SUCCESS' : 'FAIL');
    if (!passed) process.exitCode = 1;
  } finally {
    cleanup();
  }
})().catch((error) => {
  console.error(error);
  cleanup();
  process.exit(1);
});
