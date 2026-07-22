#!/usr/bin/env node
'use strict';

/**
 * Asset Bundle loop without the IDE:
 *   1. create assets/testbundle/ with a .meta carrying userData.isBundle
 *   2. put three assets inside: hero.prefab (JSON), icon.png (auto-import),
 *      notes.txt (TextAsset)
 *   3. browser: assetManager.loadBundle('testbundle') → mirror synthesizes
 *      /assets/testbundle/config.json + index.js on the fly
 *   4. bundle.load('hero', Prefab) / bundle.load('icon/spriteFrame', SpriteFrame)
 *      / bundle.load('notes', TextAsset) — path-based, like built bundles
 * `--cleanup` removes the test files.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const puppeteer = require('puppeteer-core');

const PROJECT = 'd:/tempWorkspace/baseAIAutoCocos';
const ASSETS = path.join(PROJECT, 'assets');
const DIR = path.join(ASSETS, 'testbundle');
const URL = 'http://127.0.0.1:7460/?autoReload=false';
const LABEL_TEXT = 'BUNDLE PREFAB OK';
const TEXT_BODY = 'bundle text asset OK';

// ---- tiny PNG encoder (solid RGBA) ----
function crc32(buf) {
  let c; let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function makePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 4);
    for (let x = 0; x < width; x++) raw.set(rgba, row + 1 + x * 4);
  }
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function prefabJson() {
  return [
    {
      __type__: 'cc.Prefab',
      _name: 'hero',
      _objFlags: 0,
      __editorExtras__: {},
      _native: '',
      data: { __id__: 1 },
      optimizationPolicy: 0,
      persistent: false,
    },
    {
      __type__: 'cc.Node',
      _name: 'hero',
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
      _contentSize: { __type__: 'cc.Size', width: 200, height: 60 },
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
      _actualFontSize: 20,
      _fontSize: 20,
      _fontFamily: 'Arial',
      _lineHeight: 25,
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
      fileId: 'bundleHeroRoot',
      instance: null,
      targetOverrides: null,
      nestedPrefabInstanceRoots: null,
    },
  ];
}

async function waitFor(desc, fn, timeoutMs = 25000, stepMs = 500) {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${desc}`);
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

function cleanup() {
  try { fs.rmSync(DIR, { recursive: true, force: true }); } catch {}
  try { fs.unlinkSync(`${DIR}.meta`); } catch {}
  console.log('[e2e-bundle] cleaned', path.relative(PROJECT, DIR));
}

if (process.argv.includes('--cleanup')) {
  cleanup();
  process.exit(0);
}

(async () => {
  cleanup();
  fs.mkdirSync(DIR, { recursive: true });

  fs.writeFileSync(`${DIR}.meta`, JSON.stringify({
    ver: '1.2.0',
    importer: 'directory',
    imported: true,
    uuid: crypto.randomUUID(),
    files: [],
    subMetas: {},
    userData: {
      isBundle: true,
      bundleConfigID: 'default',
      bundleName: 'testbundle',
      priority: 1,
    },
  }, null, 2));

  const prefabUuid = crypto.randomUUID();
  fs.writeFileSync(path.join(DIR, 'hero.prefab'), JSON.stringify(prefabJson(), null, 2));
  fs.writeFileSync(path.join(DIR, 'hero.prefab.meta'), JSON.stringify({
    ver: '1.1.50', importer: 'prefab', imported: true, uuid: prefabUuid,
    files: ['.json'], subMetas: {}, userData: { syncNodeName: 'hero' },
  }, null, 2));

  fs.writeFileSync(path.join(DIR, 'icon.png'), makePng(24, 24, [255, 128, 0, 255]));

  const textUuid = crypto.randomUUID();
  fs.writeFileSync(path.join(DIR, 'notes.txt'), TEXT_BODY);
  fs.writeFileSync(path.join(DIR, 'notes.txt.meta'), JSON.stringify({
    ver: '1.0.0', importer: 'text', imported: true, uuid: textUuid,
    files: ['.json'], subMetas: {}, userData: {},
  }, null, 2));

  console.log('[e2e-bundle] wrote testbundle: prefab =', prefabUuid, 'text =', textUuid);

  // Wait for library products (prefab sync + text import + png auto-import meta)
  const lib = (u) => path.join(PROJECT, 'library', u.slice(0, 2), `${u}.json`);
  await waitFor('prefab + text library products and png meta', () =>
    fs.existsSync(lib(prefabUuid)) && fs.existsSync(lib(textUuid)) &&
    fs.existsSync(path.join(DIR, 'icon.png.meta')));

  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  const errors = [];
  const bundleRequests = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('response', (r) => {
    if (r.url().includes('/assets/testbundle/')) bundleRequests.push([r.status(), r.url()]);
  });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction(
    () => !!(globalThis.cc && globalThis.__HEADLESS_PROBE__ && globalThis.cc.director?.getScene?.()),
    { timeout: 90000 },
  );

  const result = await page.evaluate((expectedLabel, expectedText) => new Promise((resolve) => {
    const cc = globalThis.cc;
    cc.assetManager.loadBundle('testbundle', (err, bundle) => {
      if (err) {
        resolve({ ok: false, error: 'loadBundle: ' + String(err.message || err) });
        return;
      }
      const out = { ok: true, bundleName: bundle.name };
      const loadPath = (p, type) => new Promise((res) =>
        bundle.load(p, type, (e, a) => res(e ? { err: String(e.message || e) } : { asset: a })));
      (async () => {
        const pf = await loadPath('hero', cc.Prefab);
        if (pf.err) {
          out.prefab = { ok: false, error: pf.err };
        } else {
          const node = cc.instantiate(pf.asset);
          cc.director.getScene().getChildByName('Canvas').addChild(node);
          const label = node.getComponent('cc.Label');
          out.prefab = {
            ok: label?.string === expectedLabel,
            labelText: label?.string,
          };
        }
        const sf = await loadPath('icon/spriteFrame', cc.SpriteFrame);
        out.spriteFrame = sf.err ? { ok: false, error: sf.err } : {
          ok: sf.asset instanceof cc.SpriteFrame && sf.asset.rect.width === 24,
          size: [sf.asset?.rect?.width, sf.asset?.rect?.height],
        };
        const tx = await loadPath('notes', cc.TextAsset);
        out.text = tx.err ? { ok: false, error: tx.err } : {
          ok: tx.asset instanceof cc.TextAsset && tx.asset.text === expectedText,
          len: tx.asset?.text?.length,
        };
        // directory query, like built bundles support
        const infos = bundle.getDirWithPath('', cc.Asset, []);
        out.dirCount = infos.length;
        resolve(out);
      })();
    });
  }), LABEL_TEXT, TEXT_BODY);
  await browser.close();

  console.log('[e2e-bundle] bundle requests:', JSON.stringify(bundleRequests.slice(0, 6)));
  console.log('[e2e-bundle] result:', JSON.stringify(result, null, 2));
  if (errors.length) console.log('[e2e-bundle] console errors:', errors.slice(0, 5));
  cleanup();
  if (result.ok && result.prefab?.ok && result.spriteFrame?.ok && result.text?.ok) {
    console.log('[e2e-bundle] SUCCESS — loadBundle + path-based load (prefab/spriteFrame/text)');
  } else {
    console.log('[e2e-bundle] FAIL');
    process.exit(1);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
