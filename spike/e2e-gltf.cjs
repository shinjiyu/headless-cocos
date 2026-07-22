#!/usr/bin/env node
'use strict';

/**
 * glTF/GLB importer e2e:
 *   copy Kenney sand.glb (+ colormap.png) into the test project →
 *   headless importer writes Mesh / Material / Texture / Prefab →
 *   browser loads Mesh + instantiates Prefab and asserts vertex counts.
 *
 * Requires preview-mirror on :7460 with PACKER=mini (new enough to include gltf).
 * `--cleanup` removes assets/gltf-e2e.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PROJECT = process.env.PROJECT || 'd:/tempWorkspace/baseAIAutoCocos';
const FIXTURE = path.join(__dirname, 'fixtures/gltf-kenney-sand');
const DIR = path.join(PROJECT, 'assets', 'gltf-e2e');
const URL = process.env.PROBE_URL || 'http://127.0.0.1:7460/?autoReload=false';
const LIBRARY = path.join(PROJECT, 'library');
const CLEANUP = process.argv.includes('--cleanup');

const GLB_META = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'sand.glb.meta'), 'utf8'));
const UUID = GLB_META.uuid;
const MESH_UUID = `${UUID}@46899`;
const PREFAB_UUID = `${UUID}@406e2`;

function copyFixture() {
  fs.mkdirSync(path.join(DIR, 'Textures'), { recursive: true });
  for (const rel of [
    'sand.glb',
    'sand.glb.meta',
    'Textures/colormap.png',
    'Textures/colormap.png.meta',
  ]) {
    fs.copyFileSync(path.join(FIXTURE, rel), path.join(DIR, rel));
  }
}

function wipeLibraryProducts() {
  const dir = path.join(LIBRARY, UUID.slice(0, 2));
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith(UUID)) fs.unlinkSync(path.join(dir, f));
  }
}

function waitFor(file, ms = 20000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (fs.existsSync(file)) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  }
  return fs.existsSync(file);
}

function cleanup() {
  fs.rmSync(DIR, { recursive: true, force: true });
  wipeLibraryProducts();
}

(async () => {
  if (CLEANUP) {
    cleanup();
    console.log('[e2e-gltf] cleaned');
    return;
  }

  cleanup();
  copyFixture();
  wipeLibraryProducts();
  // Touch glb to ensure watcher fires even if files already existed
  const glb = path.join(DIR, 'sand.glb');
  const st = fs.statSync(glb);
  fs.utimesSync(glb, st.atime, new Date());

  const meshJson = path.join(LIBRARY, UUID.slice(0, 2), `${MESH_UUID}.json`);
  const meshBin = path.join(LIBRARY, UUID.slice(0, 2), `${MESH_UUID}.bin`);
  const prefabJson = path.join(LIBRARY, UUID.slice(0, 2), `${PREFAB_UUID}.json`);

  console.log('[e2e-gltf] waiting for library products…');
  if (!waitFor(meshBin, 30000) || !waitFor(meshJson) || !waitFor(prefabJson)) {
    // Fallback: import directly if mirror watcher missed it
    const { importGltf } = require('./importers/gltf.cjs');
    console.warn('[e2e-gltf] watcher timeout — importing directly');
    importGltf(glb, LIBRARY);
  }
  if (!fs.existsSync(meshBin)) throw new Error('mesh bin missing after import');

  const meshMeta = JSON.parse(fs.readFileSync(meshJson, 'utf8'));
  console.log('[e2e-gltf] mesh verts=', meshMeta._struct.vertexBundles[0].view.count,
    'indices=', meshMeta._struct.primitives[0].indexView.count,
    'bin=', fs.statSync(meshBin).size);

  const chromePaths = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ].filter(Boolean);
  const executablePath = chromePaths.find((p) => fs.existsSync(p));
  if (!executablePath) throw new Error('Chrome not found');

  const browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('[chrome]', m.text());
  });
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 120000 });
  await page.waitForFunction(() => globalThis.cc && globalThis.cc.director && globalThis.cc.director.getScene(), {
    timeout: 90000,
  });

  const result = await page.evaluate((meshUuid, prefabUuid) => new Promise((resolve) => {
    const cc = globalThis.cc;
    const out = { mesh: null, prefab: null, error: null, meshRendererClass: !!cc.MeshRenderer };
    cc.assetManager.loadAny({ uuid: meshUuid }, (err, mesh) => {
      if (err) {
        out.error = String(err);
        resolve(out);
        return;
      }
      out.mesh = {
        type: mesh?.constructor?.name,
        struct: !!(mesh && mesh.struct),
        vert: mesh?.struct?.vertexBundles?.[0]?.view?.count ?? null,
        idx: mesh?.struct?.primitives?.[0]?.indexView?.count ?? null,
      };
      cc.assetManager.loadAny({ uuid: prefabUuid }, (err2, prefab) => {
        if (err2) {
          out.error = String(err2);
          resolve(out);
          return;
        }
        try {
          const node = cc.instantiate(prefab);
          const scene = cc.director.getScene();
          scene.addChild(node);
          out.prefab = {
            type: prefab?.constructor?.name,
            childCount: node.children?.length ?? 0,
            rootName: node.name,
          };
          if (cc.MeshRenderer) {
            const mr = node.getComponentInChildren(cc.MeshRenderer);
            out.prefab.hasMeshRenderer = !!mr;
            out.prefab.materialCount = mr?.sharedMaterials?.length ?? 0;
          } else {
            // 2D-oriented engine module set: MeshRenderer class absent; still
            // prove the prefab asset deserializes and instantiates.
            out.prefab.hasMeshRenderer = null;
          }
        } catch (e) {
          out.error = String(e && e.stack || e);
        }
        resolve(out);
      });
    });
  }), MESH_UUID, PREFAB_UUID);

  await browser.close();
  console.log('[e2e-gltf] runtime:', JSON.stringify(result, null, 2));

  if (result.error) throw new Error(result.error);
  if (!result.mesh || result.mesh.vert !== 60 || result.mesh.idx !== 96) {
    throw new Error(`unexpected mesh stats ${JSON.stringify(result.mesh)}`);
  }
  if (!result.prefab || result.prefab.type !== 'Prefab' || result.prefab.childCount < 1) {
    throw new Error(`prefab instantiate failed ${JSON.stringify(result.prefab)}`);
  }
  // Disk prefab must reference MeshRenderer even if runtime class is stripped
  const prefabDisk = JSON.parse(fs.readFileSync(prefabJson, 'utf8'));
  if (!prefabDisk.some((o) => o && o.__type__ === 'cc.MeshRenderer')) {
    throw new Error('disk prefab missing cc.MeshRenderer');
  }

  console.log('[e2e-gltf] SUCCESS — glTF import → Mesh + Prefab (runtime MeshRenderer class:',
    result.meshRendererClass, ')');
  cleanup();
})().catch((err) => {
  console.error('[e2e-gltf] FAILED', err);
  process.exit(1);
});
