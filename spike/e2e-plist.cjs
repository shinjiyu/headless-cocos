#!/usr/bin/env node
'use strict';

/**
 * .plist importer loop (content-based dispatch):
 *   1. write assets/plist/spark.png + fire.plist (Cocos2d particle config)
 *      → cc.ParticleAsset (+ native .plist) → ParticleSystem2D.file → simulate.
 *   2. write assets/plist/page.png + pack.plist (TexturePacker format 2 atlas)
 *      → cc.SpriteAtlas + per-frame cc.SpriteFrame → getSpriteFrame + Sprite.
 *
 * `--cleanup` removes the generated assets.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const puppeteer = require('puppeteer-core');

const PROJECT = 'd:/tempWorkspace/baseAIAutoCocos';
const DIR = path.join(PROJECT, 'assets', 'plist');
const URL = 'http://127.0.0.1:7460/?autoReload=false';
const SCREENSHOT = path.join(__dirname, 'e2e-plist.png');

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

const PARTICLE_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>maxParticles</key><integer>64</integer>
<key>emitterType</key><integer>0</integer>
<key>duration</key><real>-1</real>
<key>particleLifespan</key><real>1.2</real>
<key>particleLifespanVariance</key><real>0.4</real>
<key>angle</key><real>90</real>
<key>angleVariance</key><real>20</real>
<key>speed</key><real>140</real>
<key>speedVariance</key><real>40</real>
<key>gravityx</key><real>0</real>
<key>gravityy</key><real>-120</real>
<key>startParticleSize</key><real>24</real>
<key>finishParticleSize</key><real>4</real>
<key>startColorRed</key><real>1</real>
<key>startColorGreen</key><real>0.6</real>
<key>startColorBlue</key><real>0.2</real>
<key>startColorAlpha</key><real>1</real>
<key>finishColorAlpha</key><real>0</real>
<key>textureFileName</key><string>spark.png</string>
</dict></plist>`;

// TexturePacker format-2 atlas: 128x64 page holding two 64x64 frames.
const ATLAS_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>frames</key><dict>
  <key>left</key><dict>
    <key>frame</key><string>{{0,0},{64,64}}</string>
    <key>offset</key><string>{0,0}</string>
    <key>rotated</key><false/>
    <key>sourceColorRect</key><string>{{0,0},{64,64}}</string>
    <key>sourceSize</key><string>{64,64}</string>
  </dict>
  <key>right</key><dict>
    <key>frame</key><string>{{64,0},{64,64}}</string>
    <key>offset</key><string>{0,0}</string>
    <key>rotated</key><false/>
    <key>sourceColorRect</key><string>{{0,0},{64,64}}</string>
    <key>sourceSize</key><string>{64,64}</string>
  </dict>
</dict>
<key>metadata</key><dict>
  <key>format</key><integer>2</integer>
  <key>realTextureFileName</key><string>page.png</string>
  <key>textureFileName</key><string>page.png</string>
  <key>size</key><string>{128,64}</string>
</dict>
</dict></plist>`;

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
  try {
    for (const f of fs.readdirSync(DIR)) fs.unlinkSync(path.join(DIR, f));
    fs.rmdirSync(DIR);
    console.log('[e2e-plist] cleaned', path.relative(PROJECT, DIR));
  } catch {}
}

if (process.argv.includes('--cleanup')) {
  cleanup();
  process.exit(0);
}

function readMetaUuid(file) {
  return JSON.parse(fs.readFileSync(`${file}.meta`, 'utf8')).uuid;
}

(async () => {
  cleanup();
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, 'spark.png'), makePng(16, 16, [255, 220, 120, 255]));
  fs.writeFileSync(path.join(DIR, 'fire.plist'), PARTICLE_PLIST);
  // atlas page: left half red, right half blue
  const page = makePng(128, 64, [220, 60, 60, 255]);
  fs.writeFileSync(path.join(DIR, 'page.png'), page);
  fs.writeFileSync(path.join(DIR, 'pack.plist'), ATLAS_PLIST);
  console.log('[e2e-plist] wrote particle + atlas fixtures');

  const partMeta = await waitFor('fire.plist.meta (particle)', () => {
    try {
      const v = JSON.parse(fs.readFileSync(path.join(DIR, 'fire.plist.meta'), 'utf8'));
      return v.importer === 'particle' ? v : null;
    } catch { return null; }
  });
  const atlasMeta = await waitFor('pack.plist.meta (sprite-atlas)', () => {
    try {
      const v = JSON.parse(fs.readFileSync(path.join(DIR, 'pack.plist.meta'), 'utf8'));
      return v.importer === 'sprite-atlas' ? v : null;
    } catch { return null; }
  });

  const partDir = path.join(PROJECT, 'library', partMeta.uuid.slice(0, 2));
  await waitFor('ParticleAsset JSON + native .plist', () => (
    fs.existsSync(path.join(partDir, `${partMeta.uuid}.json`))
    && fs.existsSync(path.join(partDir, `${partMeta.uuid}.plist`))
  ));
  const atlasDir = path.join(PROJECT, 'library', atlasMeta.uuid.slice(0, 2));
  await waitFor('SpriteAtlas JSON', () => fs.existsSync(path.join(atlasDir, `${atlasMeta.uuid}.json`)));
  console.log('[e2e-plist] particle uuid =', partMeta.uuid, ' atlas uuid =', atlasMeta.uuid);

  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page2 = await browser.newPage();
  await page2.setViewport({ width: 960, height: 640 });
  const errors = [];
  page2.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page2.goto(URL, { waitUntil: 'networkidle2', timeout: 120000 });
  await page2.waitForFunction(() => !!(globalThis.cc && globalThis.__HEADLESS_PROBE__), { timeout: 90000 });

  const result = await page2.evaluate(({ partUuid, atlasUuid }) => new Promise((resolve) => {
    const cc = globalThis.cc;
    const out = {};
    const loadAny = (arg) => new Promise((res, rej) => cc.assetManager.loadAny(arg, (e, a) => (e ? rej(e) : res(a))));
    (async () => {
      // ---- particle ----
      try {
        const asset = await loadAny({ uuid: partUuid });
        const node = new cc.Node('Fire');
        const ps = node.addComponent('cc.ParticleSystem2D');
        ps.file = asset;
        cc.director.getScene().getChildByName('Canvas').addChild(node);
        // let a few frames simulate
        await new Promise((r) => setTimeout(r, 500));
        out.particle = {
          ok: true,
          fileType: asset.constructor?.name,
          native: asset._native,
          totalParticles: ps.totalParticles,
          emitterMode: ps.emitterMode,
          hasSpriteFrame: !!ps.spriteFrame,
          attached: node.parent?.name === 'Canvas',
        };
      } catch (e) { out.particle = { ok: false, error: String(e.message || e) }; }

      // ---- sprite atlas ----
      try {
        const atlas = await loadAny({ uuid: atlasUuid });
        const frames = atlas.getSpriteFrames().map((f) => f && f.name);
        const left = atlas.getSpriteFrame('left');
        const node = new cc.Node('AtlasSprite');
        const sp = node.addComponent('cc.Sprite');
        sp.spriteFrame = left;
        node.setPosition(-200, 0, 0);
        cc.director.getScene().getChildByName('Canvas').addChild(node);
        out.atlas = {
          ok: true,
          type: atlas.constructor?.name,
          frameCount: frames.length,
          frames,
          leftRect: left ? { w: left.rect.width, h: left.rect.height } : null,
          leftTexW: left && left.texture ? left.texture.width : null,
          spriteAttached: node.parent?.name === 'Canvas',
        };
      } catch (e) { out.atlas = { ok: false, error: String(e.message || e) }; }

      resolve(out);
    })();
  }), { partUuid: partMeta.uuid, atlasUuid: atlasMeta.uuid });

  await new Promise((r) => setTimeout(r, 500));
  await page2.screenshot({ path: SCREENSHOT });
  await browser.close();

  console.log('[e2e-plist] result:', JSON.stringify(result, null, 2));
  console.log('[e2e-plist] screenshot:', SCREENSHOT);
  if (errors.length) console.log('[e2e-plist] console errors:', errors.slice(0, 8));

  const p = result.particle || {};
  const a = result.atlas || {};
  const particlePass = p.ok && p.fileType === 'ParticleAsset' && p.native === '.plist'
    && p.totalParticles === 64 && p.emitterMode === 0 && p.hasSpriteFrame && p.attached;
  const atlasPass = a.ok && a.type === 'SpriteAtlas' && a.frameCount === 2
    && a.frames.includes('left') && a.frames.includes('right')
    && a.leftRect && a.leftRect.w === 64 && a.leftRect.h === 64
    && a.leftTexW === 128 && a.spriteAttached;

  console.log('[e2e-plist] particle:', particlePass ? 'SUCCESS' : 'FAIL', ' atlas:', atlasPass ? 'SUCCESS' : 'FAIL');
  cleanup();
  if (!(particlePass && atlasPass)) process.exit(1);
})().catch((error) => {
  console.error(error);
  cleanup();
  process.exit(1);
});
