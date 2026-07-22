#!/usr/bin/env node
'use strict';

/**
 * glTF hierarchy e2e (character-a: 6 meshes / 8 glTF nodes):
 *   import → prefab with 9 nodes + 6 MeshRenderers → load meshes in browser.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const puppeteer = require('puppeteer-core');
const { importGltf } = require('./importers/gltf.cjs');

const FIXTURE_SRC = 'D:/workspace/selfGame/assets/AssetPool/kenney/kenney-local/asset_584a5cb0050a70f7';
const PROJECT = process.env.PROJECT || 'd:/tempWorkspace/baseAIAutoCocos';
const DIR = path.join(PROJECT, 'assets', 'gltf-hier-e2e');
const LIBRARY = path.join(PROJECT, 'library');
const URL = process.env.PROBE_URL || 'http://127.0.0.1:7460/?autoReload=false';
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
  if (CLEANUP) { cleanup(); console.log('[e2e-gltf-hier] cleaned'); return; }
  if (!fs.existsSync(path.join(FIXTURE_SRC, 'character-a.glb'))) {
    throw new Error(`fixture missing: ${FIXTURE_SRC}`);
  }

  cleanup();
  copyFixture();
  const glb = path.join(DIR, 'character-a.glb');
  const r = importGltf(glb, LIBRARY);
  const prefabPath = path.join(LIBRARY, r.uuid.slice(0, 2), `${r.scenes[0]}.json`);
  const prefab = JSON.parse(fs.readFileSync(prefabPath, 'utf8'));
  const nodes = prefab.filter((o) => o && o.__type__ === 'cc.Node');
  const mrs = prefab.filter((o) => o && o.__type__ === 'cc.MeshRenderer');
  console.log('[e2e-gltf-hier] meshes', r.meshes.length, 'nodes', nodes.map((n) => n._name), 'MR', mrs.length);

  if (r.meshes.length !== 6) throw new Error(`expected 6 meshes, got ${r.meshes.length}`);
  if (nodes.length !== 9) throw new Error(`expected 9 nodes, got ${nodes.length}`);
  if (mrs.length !== 6) throw new Error(`expected 6 MeshRenderers, got ${mrs.length}`);
  const head = nodes.find((n) => n._name === 'head');
  if (!head || head._lscale.x !== 0.1) throw new Error(`head scale wrong ${JSON.stringify(head && head._lscale)}`);

  // Browser: load all meshes
  const chromePaths = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ].filter(Boolean);
  const executablePath = chromePaths.find((p) => fs.existsSync(p));
  if (!executablePath) throw new Error('Chrome not found');

  const browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 120000 });
  await page.waitForFunction(() => globalThis.cc && globalThis.cc.director.getScene(), { timeout: 90000 });

  const loaded = await page.evaluate((uuids) => new Promise((resolve) => {
    const cc = globalThis.cc;
    let left = uuids.length;
    const out = { ok: 0, fail: [] };
    for (const u of uuids) {
      cc.assetManager.loadAny({ uuid: u }, (err, mesh) => {
        if (err || !mesh || !mesh.struct) out.fail.push(String(err || u));
        else out.ok++;
        if (--left === 0) resolve(out);
      });
    }
  }), r.meshes);

  await browser.close();
  console.log('[e2e-gltf-hier] runtime meshes', loaded);
  if (loaded.ok !== 6) throw new Error(`mesh load failed ${JSON.stringify(loaded)}`);

  console.log('[e2e-gltf-hier] SUCCESS — hierarchy prefab + 6 meshes');
  cleanup();
})().catch((err) => {
  console.error('[e2e-gltf-hier] FAILED', err);
  process.exit(1);
});
