#!/usr/bin/env node
'use strict';

/**
 * Full no-IDE loop:
 *   1. generate a solid-color PNG into assets/ (no .meta)
 *   2. wait for the Docker importer to produce .meta + library files
 *   3. patch PreviewBoot.scene: append a Sprite node referencing the new
 *      SpriteFrame uuid (pure JSON edit, appended ids so nothing shifts)
 *   4. open the preview in headless Chrome, assert the Sprite resolved a
 *      real 64x64 SpriteFrame, and save a screenshot for visual check
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const puppeteer = require('puppeteer-core');

const PROJECT = 'd:/tempWorkspace/baseAIAutoCocos';
const ASSETS = path.join(PROJECT, 'assets');
const HERO_DIR = path.join(ASSETS, 'ui');
const HERO_PNG = path.join(HERO_DIR, 'hero.png');
const SCENE = path.join(ASSETS, 'scene', 'PreviewBoot.scene');
const URL = 'http://127.0.0.1:7460/?autoReload=false';
const SHOT = path.join(__dirname, 'e2e-scene-sprite.png');
const NODE_NAME = 'HeroSprite';

// ---- minimal PNG encoder (RGBA, no deps) ----
function crc32(buf) {
  let c, table = crc32.table;
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
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 4);
    raw[row] = 0; // filter none
    for (let x = 0; x < width; x++) {
      raw.set(rgba, row + 1 + x * 4);
    }
  }
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
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

function spriteNodeObjects(canvasId, startId, sfUuid) {
  const nodeId = startId;
  const utId = startId + 1;
  const spId = startId + 2;
  return [
    {
      __type__: 'cc.Node',
      _name: NODE_NAME,
      _objFlags: 0,
      __editorExtras__: {},
      _parent: { __id__: canvasId },
      _children: [],
      _active: true,
      _components: [{ __id__: utId }, { __id__: spId }],
      _prefab: null,
      _lpos: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
      _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 },
      _lscale: { __type__: 'cc.Vec3', x: 1, y: 1, z: 1 },
      _mobility: 0,
      _layer: 33554432,
      _euler: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
      _id: 'headlessHeroSprite01',
    },
    {
      __type__: 'cc.UITransform',
      _name: '',
      _objFlags: 0,
      __editorExtras__: {},
      node: { __id__: nodeId },
      _enabled: true,
      __prefab: null,
      _contentSize: { __type__: 'cc.Size', width: 64, height: 64 },
      _anchorPoint: { __type__: 'cc.Vec2', x: 0.5, y: 0.5 },
      _id: 'headlessHeroSpriteUT',
    },
    {
      __type__: 'cc.Sprite',
      _name: '',
      _objFlags: 0,
      __editorExtras__: {},
      node: { __id__: nodeId },
      _enabled: true,
      __prefab: null,
      _customMaterial: null,
      _srcBlendFactor: 2,
      _dstBlendFactor: 4,
      _color: { __type__: 'cc.Color', r: 255, g: 255, b: 255, a: 255 },
      _spriteFrame: { __uuid__: sfUuid, __expectedType__: 'cc.SpriteFrame' },
      _type: 0,
      _fillType: 0,
      _sizeMode: 1,
      _fillCenter: { __type__: 'cc.Vec2', x: 0, y: 0 },
      _fillStart: 0,
      _fillRange: 0,
      _isTrimmedMode: true,
      _useGrayscale: false,
      _atlas: null,
      _id: 'headlessHeroSpriteSP',
    },
  ];
}

function cleanup() {
  // remove HeroSprite objects from the scene (they were appended at the end,
  // referenced only from Canvas._children)
  try {
    const scene = JSON.parse(fs.readFileSync(SCENE, 'utf8'));
    const nodeId = scene.findIndex((o) => o && o._name === NODE_NAME);
    if (nodeId >= 0) {
      const canvas = scene.find((o) => o && o.__type__ === 'cc.Node' && o._name === 'Canvas');
      canvas._children = canvas._children.filter((c) => c.__id__ !== nodeId);
      scene.splice(nodeId, 3);
      fs.writeFileSync(SCENE, JSON.stringify(scene, null, 2));
      console.log('[e2e-scene] removed', NODE_NAME, 'from scene');
    }
  } catch (e) {
    console.warn('[e2e-scene] scene cleanup failed:', e.message);
  }
  for (const f of [HERO_PNG, HERO_PNG + '.meta']) {
    try { fs.unlinkSync(f); console.log('[e2e-scene] removed', path.relative(PROJECT, f)); } catch {}
  }
  try { fs.rmdirSync(HERO_DIR); } catch {}
}

if (process.argv.includes('--cleanup')) {
  cleanup();
  process.exit(0);
}

(async () => {
  // 1. drop a fresh PNG (solid red) without .meta
  fs.mkdirSync(HERO_DIR, { recursive: true });
  fs.writeFileSync(HERO_PNG, makePng(64, 64, [255, 40, 40, 255]));
  console.log('[e2e-scene] wrote', path.relative(PROJECT, HERO_PNG));

  // 2. the container's polling importer must create the .meta on its own
  const meta = await waitFor('hero.png.meta from container importer', () => {
    try { return JSON.parse(fs.readFileSync(HERO_PNG + '.meta', 'utf8')); } catch { return null; }
  });
  const sfUuid = meta.subMetas?.f9941?.uuid;
  if (!sfUuid) throw new Error('meta has no spriteFrame subMeta');
  console.log('[e2e-scene] imported, spriteFrame uuid =', sfUuid);
  await waitFor('library spriteFrame json', () => {
    return fs.existsSync(path.join(PROJECT, 'library', meta.uuid.slice(0, 2), `${sfUuid}.json`));
  });

  // 3. patch the scene JSON (append-only so __id__ refs stay valid)
  const scene = JSON.parse(fs.readFileSync(SCENE, 'utf8'));
  if (!scene.some((o) => o && o._name === NODE_NAME)) {
    const canvasId = scene.findIndex((o) => o && o.__type__ === 'cc.Node' && o._name === 'Canvas');
    if (canvasId < 0) throw new Error('Canvas node not found in scene');
    const startId = scene.length;
    scene[canvasId]._children.push({ __id__: startId });
    scene.push(...spriteNodeObjects(canvasId, startId, sfUuid));
    fs.writeFileSync(SCENE, JSON.stringify(scene, null, 2));
    console.log('[e2e-scene] appended', NODE_NAME, 'to PreviewBoot.scene');
  } else {
    console.log('[e2e-scene] scene already has', NODE_NAME);
  }

  // give the container watcher time to sync scene → library
  await new Promise((r) => setTimeout(r, 3000));

  // 4. verify in the browser
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 640 });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction(
    () => !!(globalThis.cc && globalThis.__HEADLESS_PROBE__ && globalThis.cc.director?.getScene?.()),
    { timeout: 90000 },
  );

  const state = await page.waitForFunction((nodeName) => {
    const scene = globalThis.cc.director.getScene();
    const node = scene?.getChildByName('Canvas')?.getChildByName(nodeName);
    if (!node) return null;
    const sprite = node.getComponent('cc.Sprite');
    const sf = sprite?.spriteFrame;
    if (!sf || !sf.texture || sf.rect.width <= 2) return null;
    return {
      node: node.name,
      sf: sf.name,
      w: sf.rect.width,
      h: sf.rect.height,
      texW: sf.texture.width,
      texH: sf.texture.height,
    };
  }, { timeout: 30000 }, NODE_NAME).then((h) => h.jsonValue());

  await new Promise((r) => setTimeout(r, 1000));
  await page.screenshot({ path: SHOT });
  await browser.close();

  console.log('[e2e-scene] sprite state:', JSON.stringify(state));
  console.log('[e2e-scene] screenshot:', SHOT);
  if (errors.length) console.log('[e2e-scene] console errors:', errors.slice(0, 5));
  // texW may be 64 (standalone) or 2048 (packed into the runtime dynamic
  // atlas) — both mean the texture uploaded fine; the rect is what matters.
  if (state.w === 64 && state.h === 64 && state.texW >= 64) {
    console.log('[e2e-scene] SUCCESS — new PNG → auto import → scene JSON edit → rendered sprite');
  } else {
    console.log('[e2e-scene] FAIL — unexpected sprite state');
    process.exit(1);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
