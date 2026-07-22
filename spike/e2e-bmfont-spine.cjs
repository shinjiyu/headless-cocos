#!/usr/bin/env node
'use strict';

/**
 * BMFont + Spine importer loop:
 *   1. write assets/bmfont/probe.fnt + page PNG, and assets/spineboy/probe
 *      .json/.atlas/.png (minimal Spine 3.8 export) — no .meta files
 *   2. container importers produce cc.BitmapFont / sp.SkeletonData in library
 *   3. browser loadAny() both; BMFont must have letter defs + SpriteFrame,
 *      SkeletonData must parse through the Spine 3.8 wasm runtime
 * `--cleanup` removes the test files.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const puppeteer = require('puppeteer-core');

const PROJECT = 'd:/tempWorkspace/baseAIAutoCocos';
const ASSETS = path.join(PROJECT, 'assets');
const BM_DIR = path.join(ASSETS, 'bmfont');
const SP_DIR = path.join(ASSETS, 'spineboy');
const URL = 'http://127.0.0.1:7460/?autoReload=false';

// ---- tiny PNG encoder (solid RGBA) ----
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

const FNT = `info face="probe" size=32 bold=0 italic=0 charset="" unicode=1 stretchH=100 smooth=1 aa=1 padding=0,0,0,0 spacing=1,1 outline=0
common lineHeight=36 base=29 scaleW=64 scaleH=64 pages=1 packed=0
page id=0 file="bmpage.png"
chars count=2
char id=65 x=0 y=0 width=20 height=24 xoffset=0 yoffset=4 xadvance=22 page=0 chnl=15
char id=66 x=20 y=0 width=20 height=24 xoffset=0 yoffset=4 xadvance=22 page=0 chnl=15
kernings count=1
kerning first=65 second=66 amount=-2
`;

const SPINE_JSON = {
  skeleton: { hash: 'headless', spine: '3.8.75', x: -32, y: -32, width: 64, height: 64, images: './', audio: '' },
  bones: [{ name: 'root' }],
  slots: [{ name: 'card', bone: 'root', attachment: 'card' }],
  skins: [{ name: 'default', attachments: { card: { card: { x: 0, y: 0, width: 64, height: 64 } } } }],
  animations: { idle: {} },
};

const SPINE_ATLAS = `
probe.png
size: 64,64
format: RGBA8888
filter: Linear,Linear
repeat: none
card
  rotate: false
  xy: 0, 0
  size: 64, 64
  orig: 64, 64
  offset: 0, 0
  index: -1
`;

const FILES = {
  bm: [path.join(BM_DIR, 'probe.fnt'), path.join(BM_DIR, 'bmpage.png')],
  sp: [path.join(SP_DIR, 'probe.json'), path.join(SP_DIR, 'probe.atlas'), path.join(SP_DIR, 'probe.png')],
};

async function waitFor(desc, fn, timeoutMs = 25000, stepMs = 500) {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${desc}`);
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

if (process.argv.includes('--cleanup')) {
  for (const f of [...FILES.bm, ...FILES.sp]) {
    for (const p of [f, f + '.meta']) {
      try { fs.unlinkSync(p); console.log('[e2e-bs] removed', path.relative(PROJECT, p)); } catch {}
    }
  }
  for (const d of [BM_DIR, SP_DIR]) { try { fs.rmdirSync(d); } catch {} }
  process.exit(0);
}

(async () => {
  fs.mkdirSync(BM_DIR, { recursive: true });
  fs.mkdirSync(SP_DIR, { recursive: true });
  fs.writeFileSync(path.join(BM_DIR, 'bmpage.png'), makePng(64, 64, [255, 255, 255, 255]));
  fs.writeFileSync(path.join(BM_DIR, 'probe.fnt'), FNT);
  fs.writeFileSync(path.join(SP_DIR, 'probe.png'), makePng(64, 64, [80, 200, 120, 255]));
  fs.writeFileSync(path.join(SP_DIR, 'probe.atlas'), SPINE_ATLAS);
  fs.writeFileSync(path.join(SP_DIR, 'probe.json'), JSON.stringify(SPINE_JSON, null, 2));
  console.log('[e2e-bs] wrote bmfont + spine test assets');

  const bmMeta = await waitFor('probe.fnt.meta', () => {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(BM_DIR, 'probe.fnt.meta'), 'utf8'));
      return m.importer === 'bitmap-font' ? m : null;
    } catch { return null; }
  });
  const spMeta = await waitFor('spine probe.json.meta', () => {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(SP_DIR, 'probe.json.meta'), 'utf8'));
      return m.importer === 'spine-data' ? m : null;
    } catch { return null; }
  });
  console.log('[e2e-bs] imported bmfont =', bmMeta.uuid, ' spine =', spMeta.uuid);
  await waitFor('library jsons', () => {
    return (
      fs.existsSync(path.join(PROJECT, 'library', bmMeta.uuid.slice(0, 2), `${bmMeta.uuid}.json`)) &&
      fs.existsSync(path.join(PROJECT, 'library', spMeta.uuid.slice(0, 2), `${spMeta.uuid}.json`))
    );
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

  const result = await page.evaluate(async (bmUuid, spUuid) => {
    const cc = globalThis.cc;
    const load = (uuid) => new Promise((resolve) => {
      cc.assetManager.loadAny({ uuid }, (err, a) => resolve(err ? { err: String(err.message || err) } : { asset: a }));
    });

    const out = {};

    const bm = await load(bmUuid);
    if (bm.err) {
      out.bmfont = { ok: false, error: bm.err };
    } else {
      const font = bm.asset;
      const letters = font.fontDefDictionary?.letterDefinitions || {};
      out.bmfont = {
        ok: true,
        type: font.constructor?.name,
        fontSize: font.fontSize,
        letterA: letters['65'] ? { w: letters['65'].w, h: letters['65'].h, xAdvance: letters['65'].xAdvance } : null,
        kerning: font.fntConfig?.kerningDict ? Object.keys(font.fntConfig.kerningDict).length : 0,
        spriteFrameOk: !!(font.spriteFrame && font.spriteFrame.texture && font.spriteFrame.rect.width > 2),
      };
      // Render a Label with it to prove the full chain
      try {
        const node = new cc.Node('BMLabel');
        const label = node.addComponent(cc.Label);
        label.font = font;
        label.string = 'AB';
        cc.director.getScene().getChildByName('Canvas').addChild(node);
        out.bmfont.labelAttached = true;
      } catch (e) {
        out.bmfont.labelAttached = 'error: ' + String(e.message || e);
      }
    }

    const sp = await load(spUuid);
    if (sp.err) {
      out.spine = { ok: false, error: sp.err };
    } else {
      const data = sp.asset;
      out.spine = {
        ok: true,
        type: data.constructor?.name,
        hasJson: !!data._skeletonJson,
        textures: data.textures?.length,
        texW: data.textures?.[0]?.width,
        pages: data.textureNames,
      };
      try {
        const runtime = data.getRuntimeData();
        out.spine.runtime = runtime
          ? { animations: runtime.animations?.size ?? runtime.animations?.length, bones: runtime.bones?.size ?? runtime.bones?.length }
          : null;
      } catch (e) {
        out.spine.runtime = 'error: ' + String(e.message || e);
      }
      try {
        const node = new cc.Node('SpineNode');
        const sk = node.addComponent(cc.internal.SpineSkeletonData ? 'sp.Skeleton' : 'sp.Skeleton');
        sk.skeletonData = data;
        sk.setAnimation(0, 'idle', true);
        cc.director.getScene().getChildByName('Canvas').addChild(node);
        out.spine.componentAttached = true;
      } catch (e) {
        out.spine.componentAttached = 'error: ' + String(e.message || e);
      }
    }
    return out;
  }, bmMeta.uuid, spMeta.uuid);
  await new Promise((r) => setTimeout(r, 800));
  await browser.close();

  console.log('[e2e-bs] result:', JSON.stringify(result, null, 2));
  if (errors.length) console.log('[e2e-bs] console errors:', errors.slice(0, 8));

  const bmOk = result.bmfont?.ok && result.bmfont.type === 'BitmapFont'
    && result.bmfont.letterA && result.bmfont.letterA.w === 20
    && result.bmfont.spriteFrameOk && result.bmfont.labelAttached === true;
  const spOk = result.spine?.ok && result.spine.type === 'SkeletonData'
    && result.spine.hasJson && result.spine.textures === 1
    && result.spine.runtime && typeof result.spine.runtime === 'object';

  console.log(`[e2e-bs] bmfont: ${bmOk ? 'SUCCESS' : 'FAIL'}  spine: ${spOk ? 'SUCCESS' : 'FAIL'}`);
  if (!bmOk || !spOk) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
