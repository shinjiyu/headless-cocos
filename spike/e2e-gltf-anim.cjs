#!/usr/bin/env node
'use strict';

/**
 * glTF animation e2e (character-a: 27 ExoticAnimation clips).
 * Disk: import + CCON decode + prefab Animation wiring.
 * Optional browser: load idle clip via assetManager (PROBE_URL).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { importGltf } = require('./importers/gltf.cjs');
const { decodeCCONBinary } = require('./importers/ccon.cjs');

const FIXTURE_SRC =
  process.env.GLTF_ANIM_FIXTURE ||
  'D:/workspace/selfGame/assets/AssetPool/kenney/kenney-local/asset_584a5cb0050a70f7';
const PROJECT = process.env.PROJECT || 'd:/tempWorkspace/baseAIAutoCocos';
const DIR = path.join(PROJECT, 'assets', 'gltf-anim-e2e');
const LIBRARY = path.join(PROJECT, 'library');
const URL = process.env.PROBE_URL || 'http://127.0.0.1:7460/?autoReload=false';
const SKIP_BROWSER = process.argv.includes('--disk-only');
const CLEANUP = process.argv.includes('--cleanup');

function cleanup() {
  fs.rmSync(DIR, { recursive: true, force: true });
}

function copyFixture() {
  fs.mkdirSync(path.join(DIR, 'Textures'), { recursive: true });
  fs.copyFileSync(path.join(FIXTURE_SRC, 'character-a.glb'), path.join(DIR, 'character-a.glb'));
  fs.copyFileSync(path.join(FIXTURE_SRC, 'character-a.glb.meta'), path.join(DIR, 'character-a.glb.meta'));
  const texDir = path.join(FIXTURE_SRC, 'Textures');
  if (fs.existsSync(texDir)) {
    for (const f of fs.readdirSync(texDir)) {
      fs.copyFileSync(path.join(texDir, f), path.join(DIR, 'Textures', f));
    }
  }
}

(async () => {
  if (CLEANUP) {
    cleanup();
    console.log('[e2e-gltf-anim] cleaned');
    return;
  }
  if (!fs.existsSync(path.join(FIXTURE_SRC, 'character-a.glb'))) {
    throw new Error(`fixture missing: ${FIXTURE_SRC}`);
  }

  cleanup();
  copyFixture();
  const glb = path.join(DIR, 'character-a.glb');
  const r = importGltf(glb, LIBRARY);
  if (r.animations.length !== 27) {
    throw new Error(`expected 27 animations, got ${r.animations.length}`);
  }

  const idle = r.animations.find((u) => u.endsWith('@1f586'));
  if (!idle) throw new Error('idle @1f586 missing — meta sub-ids not preserved?');
  const idleBin = path.join(LIBRARY, idle.slice(0, 2), `${idle}.bin`);
  const ccon = decodeCCONBinary(fs.readFileSync(idleBin));
  if (ccon.document[0].__type__ !== 'cc.AnimationClip') throw new Error('bad clip type');
  if (ccon.document[0]._name !== 'idle') throw new Error(`bad clip name ${ccon.document[0]._name}`);
  if (ccon.document[1].__type__ !== 'cc.animation.ExoticAnimation') {
    throw new Error('missing ExoticAnimation');
  }
  if (ccon.document[1]._nodeAnimations.length !== 8) {
    throw new Error(`expected 8 node anims, got ${ccon.document[1]._nodeAnimations.length}`);
  }
  if (Math.abs(ccon.document[0]._duration - 1.3333333730697632) > 1e-5) {
    throw new Error(`bad duration ${ccon.document[0]._duration}`);
  }

  const prefab = JSON.parse(
    fs.readFileSync(path.join(LIBRARY, r.uuid.slice(0, 2), `${r.scenes[0]}.json`), 'utf8'),
  );
  const anim = prefab.find((o) => o && o.__type__ === 'cc.Animation');
  if (!anim || anim._clips.length !== 27) {
    throw new Error(`prefab Animation clips ${anim && anim._clips.length}`);
  }
  console.log('[e2e-gltf-anim] disk OK', { idle, duration: ccon.document[0]._duration, clips: 27 });

  if (SKIP_BROWSER) {
    cleanup();
    console.log('[e2e-gltf-anim] SUCCESS — disk only');
    return;
  }

  let puppeteer;
  try {
    puppeteer = require('puppeteer-core');
  } catch {
    cleanup();
    console.log('[e2e-gltf-anim] SUCCESS — disk only (no puppeteer)');
    return;
  }

  const chromePaths = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ].filter(Boolean);
  const executablePath = chromePaths.find((p) => fs.existsSync(p));
  if (!executablePath) {
    cleanup();
    console.log('[e2e-gltf-anim] SUCCESS — disk only (no Chrome)');
    return;
  }

  const browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  try {
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 120000 });
    await page.waitForFunction(() => globalThis.cc && globalThis.cc.director.getScene(), {
      timeout: 90000,
    });
    const loaded = await page.evaluate(
      (uuid) =>
        new Promise((resolve) => {
          const cc = globalThis.cc;
          cc.assetManager.loadAny({ uuid }, (err, clip) => {
            if (err || !clip) return resolve({ ok: false, err: String(err || 'null') });
            resolve({
              ok: true,
              name: clip.name || clip._name,
              duration: clip.duration || clip._duration,
              hasExotic: !!(clip._exoticAnimation || (clip.exoticAnimationTag && clip[clip.exoticAnimationTag])),
            });
          });
        }),
      idle,
    );
    console.log('[e2e-gltf-anim] runtime', loaded);
    if (!loaded.ok) throw new Error(`clip load failed ${JSON.stringify(loaded)}`);
    if (loaded.name !== 'idle') throw new Error(`runtime name ${loaded.name}`);
  } finally {
    await browser.close();
  }

  console.log('[e2e-gltf-anim] SUCCESS — disk + runtime clip load');
  cleanup();
})().catch((err) => {
  console.error('[e2e-gltf-anim] FAILED', err);
  process.exit(1);
});
