#!/usr/bin/env node
'use strict';

/**
 * Prefab loop without the IDE:
 *   1. write assets/prefabs/HeroCard.prefab (pure JSON) + .meta with a fresh
 *      uuid — a Node with UITransform + Label
 *   2. asset-sync copies it into library/
 *   3. browser loadAny({uuid}) → cc.Prefab; instantiate() → node tree with
 *      the Label text intact
 * `--cleanup` removes the test files.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PROJECT = 'd:/tempWorkspace/baseAIAutoCocos';
const ASSETS = path.join(PROJECT, 'assets');
const PREFAB_DIR = path.join(ASSETS, 'prefabs');
const PREFAB = path.join(PREFAB_DIR, 'HeroCard.prefab');
const URL = 'http://127.0.0.1:7460/?autoReload=false';
const LABEL_TEXT = 'HEADLESS PREFAB OK';

function prefabJson() {
  return [
    {
      __type__: 'cc.Prefab',
      _name: 'HeroCard',
      _objFlags: 0,
      __editorExtras__: {},
      _native: '',
      data: { __id__: 1 },
      optimizationPolicy: 0,
      persistent: false,
    },
    {
      __type__: 'cc.Node',
      _name: 'HeroCard',
      _objFlags: 0,
      __editorExtras__: {},
      _parent: null,
      _children: [],
      _active: true,
      _components: [{ __id__: 2 }, { __id__: 3 }],
      _prefab: { __id__: 4 },
      _lpos: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
      _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 },
      _lscale: { __type__: 'cc.Vec3', x: 1, y: 1, z: 1 },
      _mobility: 0,
      _layer: 33554432,
      _euler: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
      _id: '',
    },
    {
      __type__: 'cc.UITransform',
      _name: '',
      _objFlags: 0,
      __editorExtras__: {},
      node: { __id__: 1 },
      _enabled: true,
      __prefab: null,
      _contentSize: { __type__: 'cc.Size', width: 300, height: 80 },
      _anchorPoint: { __type__: 'cc.Vec2', x: 0.5, y: 0.5 },
      _id: '',
    },
    {
      __type__: 'cc.Label',
      _name: '',
      _objFlags: 0,
      __editorExtras__: {},
      node: { __id__: 1 },
      _enabled: true,
      __prefab: null,
      _customMaterial: null,
      _srcBlendFactor: 2,
      _dstBlendFactor: 4,
      _color: { __type__: 'cc.Color', r: 255, g: 255, b: 255, a: 255 },
      _string: LABEL_TEXT,
      _horizontalAlign: 1,
      _verticalAlign: 1,
      _actualFontSize: 24,
      _fontSize: 24,
      _fontFamily: 'Arial',
      _lineHeight: 32,
      _overflow: 0,
      _enableWrapText: true,
      _font: null,
      _isSystemFontUsed: true,
      _isItalic: false,
      _isBold: false,
      _isUnderline: false,
      _underlineHeight: 2,
      _cacheMode: 0,
      _id: '',
    },
    {
      __type__: 'cc.PrefabInfo',
      root: { __id__: 1 },
      asset: { __id__: 0 },
      fileId: 'headlessHeroCardRoot',
      instance: null,
      targetOverrides: null,
      nestedPrefabInstanceRoots: null,
    },
  ];
}

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
  for (const f of [PREFAB, PREFAB + '.meta']) {
    try { fs.unlinkSync(f); console.log('[e2e-prefab] removed', path.relative(PROJECT, f)); } catch {}
  }
  try { fs.rmdirSync(PREFAB_DIR); } catch {}
  process.exit(0);
}

(async () => {
  const uuid = crypto.randomUUID();
  fs.mkdirSync(PREFAB_DIR, { recursive: true });
  fs.writeFileSync(PREFAB, JSON.stringify(prefabJson(), null, 2));
  fs.writeFileSync(PREFAB + '.meta', JSON.stringify({
    ver: '1.1.50',
    importer: 'prefab',
    imported: true,
    uuid,
    files: ['.json'],
    subMetas: {},
    userData: { syncNodeName: 'HeroCard' },
  }, null, 2));
  console.log('[e2e-prefab] wrote', path.relative(PROJECT, PREFAB), 'uuid =', uuid);

  await waitFor('library prefab json from asset-sync', () => {
    return fs.existsSync(path.join(PROJECT, 'library', uuid.slice(0, 2), `${uuid}.json`));
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
    () => !!(globalThis.cc && globalThis.__HEADLESS_PROBE__ && globalThis.cc.director?.getScene?.()),
    { timeout: 90000 },
  );

  const result = await page.evaluate((prefabUuid, expected) => new Promise((resolve) => {
    const cc = globalThis.cc;
    cc.assetManager.loadAny({ uuid: prefabUuid }, (err, prefab) => {
      if (err) {
        resolve({ ok: false, error: String(err.message || err) });
        return;
      }
      try {
        const node = cc.instantiate(prefab);
        const canvas = cc.director.getScene().getChildByName('Canvas');
        canvas.addChild(node);
        const label = node.getComponent('cc.Label');
        const ut = node.getComponent('cc.UITransform');
        resolve({
          ok: true,
          type: prefab?.constructor?.name,
          prefabName: prefab?.name,
          nodeName: node.name,
          labelText: label?.string,
          labelMatches: label?.string === expected,
          size: ut ? [ut.contentSize.width, ut.contentSize.height] : null,
          inScene: node.parent === canvas,
        });
      } catch (e) {
        resolve({ ok: false, error: 'instantiate: ' + String(e.message || e) });
      }
    });
  }), uuid, LABEL_TEXT);
  await browser.close();

  console.log('[e2e-prefab] result:', JSON.stringify(result));
  if (errors.length) console.log('[e2e-prefab] console errors:', errors.slice(0, 5));
  if (result.ok && result.type === 'Prefab' && result.labelMatches && result.inScene) {
    console.log('[e2e-prefab] SUCCESS — JSON prefab → auto sync → instantiate in scene with Label');
  } else {
    console.log('[e2e-prefab] FAIL');
    process.exit(1);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
