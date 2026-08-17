/**
 * 从 layers.json + tiles 生成 loading-h5/（纯 H5 Splash，无 Cocos）。
 * BG = 背景层；前景 = 同方向组内除背景/范围框外全部合成一张透明图。
 * CLI: node build-loading-h5.mjs --job-dir /data/jobs/{id}
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 单档 WebP + BgPlus 十字切适配（整图不切片） */
export const LOADING_ASSET_PROFILE = 'webp-bgplus-adapt-v1';

/** 统一长边上限；不放大源图 */
const MAX_EDGE = Number(process.env.LOADING_MAX_EDGE || 2560);
const WEBP_QUALITY = Number(process.env.LOADING_WEBP_QUALITY || 82);
const AVIF_QUALITY = Number(process.env.LOADING_AVIF_QUALITY || 50);

function parseArgs(argv) {
  const out = { jobDir: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--job-dir' && argv[i + 1]) {
      out.jobDir = path.resolve(argv[++i]);
    }
  }
  return out;
}

function classifyPath(p) {
  const s = String(p || '');
  const lower = s.toLowerCase();
  if (/範圍|范围/.test(s)) return { role: 'guide', orient: null };
  let orient = null;
  if (/横|橫/.test(s) && !/竖|直/.test(s)) orient = 'landscape';
  if (/竖|直/.test(s)) orient = 'portrait';
  if (/背景|bg\b|_bg|bg_/i.test(lower) || /背景/.test(s)) {
    return { role: 'bg', orient };
  }
  // 模板约定：除背景外全部是前景（LOGO / 主体 / TAP / 文案…）
  return { role: 'fg', orient };
}

function isEffectivelyVisible(tile, sceneEdit) {
  if (tile.effectiveHidden) return false;
  if (tile.hidden) return false;
  const nodes = sceneEdit?.nodes || {};
  const n = nodes[tile.id];
  if (n && n.visible === false) return false;
  const groups = sceneEdit?.groups || {};
  const parts = String(tile.path || '').split('/').filter(Boolean);
  let acc = '';
  for (let i = 0; i < parts.length - 1; i++) {
    acc = acc ? `${acc}/${parts[i]}` : parts[i];
    const g = groups[acc] || groups[parts[i]];
    if (g && g.visible === false) return false;
  }
  return true;
}

function pickBest(candidates, preferOrient) {
  if (!candidates.length) return null;
  const exact = candidates.filter((c) => c.orient === preferOrient);
  const pool = exact.length ? exact : candidates;
  pool.sort((a, b) => b.width * b.height - a.width * a.height);
  return pool[0];
}

function resolveTileFile(exportsDir, tile) {
  const src = path.join(exportsDir, tile.file.replace(/^exports\//, ''));
  const alt = path.join(exportsDir, tile.file);
  const from = fs.existsSync(src) ? src : alt;
  if (!fs.existsSync(from)) {
    throw new Error(`tile missing: ${tile.file}`);
  }
  return from;
}

/**
 * 整图缩放到统一长边，导出 WebP（+ 可选 AVIF）。
 * @returns {Promise<{ webp: string, avif?: string, width: number, height: number }>}
 */
async function encodeBuffer(buf, assetsDir, baseName, { alpha }) {
  const meta = await sharp(buf).metadata();
  const srcW = meta.width || 1;
  const srcH = meta.height || 1;
  const long = Math.max(srcW, srcH);
  const target = Math.min(MAX_EDGE, long);
  const scale = target / long;
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));

  const webpName = `${baseName}.webp`;
  await sharp(buf)
    .resize({ width, height, fit: 'fill', withoutEnlargement: true })
    .webp({
      quality: WEBP_QUALITY,
      alphaQuality: alpha ? 85 : undefined,
      effort: 4,
    })
    .toFile(path.join(assetsDir, webpName));

  const out = {
    webp: `./assets/${webpName}`,
    width,
    height,
  };

  try {
    const avifName = `${baseName}.avif`;
    await sharp(buf)
      .resize({ width, height, fit: 'fill', withoutEnlargement: true })
      .avif({ quality: AVIF_QUALITY, effort: 4 })
      .toFile(path.join(assetsDir, avifName));
    out.avif = `./assets/${avifName}`;
  } catch {
    /* AVIF optional */
  }

  return out;
}

async function encodeSingle(srcPath, assetsDir, baseName, { alpha }) {
  return encodeBuffer(await fs.promises.readFile(srcPath), assetsDir, baseName, {
    alpha,
  });
}

/**
 * 同方向前景层合成一张透明图。
 * 绘制顺序：index 大的先画（与编辑器 zIndex=max-i 一致，小 index 在最上）。
 * @returns {Promise<null | { left: number, top: number, width: number, height: number, buffer: Buffer, paths: string[] }>}
 */
async function compositeForeground(exportsDir, fgTiles, preferOrient) {
  const exact = fgTiles.filter((t) => t.orient === preferOrient);
  const pool = exact.length ? exact : fgTiles.filter((t) => !t.orient);
  if (!pool.length) return null;

  // 先画底层（大 index），后画顶层（小 index）
  const ordered = [...pool].sort((a, b) => {
    const ia = a.index != null ? a.index : 0;
    const ib = b.index != null ? b.index : 0;
    return ib - ia;
  });

  let minL = Infinity;
  let minT = Infinity;
  let maxR = -Infinity;
  let maxB = -Infinity;
  for (const t of ordered) {
    const l = Number(t.left) || 0;
    const top = Number(t.top) || 0;
    const w = Math.max(1, Number(t.width) || 1);
    const h = Math.max(1, Number(t.height) || 1);
    minL = Math.min(minL, l);
    minT = Math.min(minT, top);
    maxR = Math.max(maxR, l + w);
    maxB = Math.max(maxB, top + h);
  }

  const width = Math.max(1, Math.ceil(maxR - minL));
  const height = Math.max(1, Math.ceil(maxB - minT));

  const composites = [];
  for (const t of ordered) {
    const file = resolveTileFile(exportsDir, t);
    let input = sharp(file);
    const op = t.opacity != null ? Number(t.opacity) : 1;
    if (op < 0.999) {
      // 乘以整体透明度
      const { data, info } = await input
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const aMul = Math.max(0, Math.min(1, op));
      for (let i = 3; i < data.length; i += 4) {
        data[i] = Math.round(data[i] * aMul);
      }
      input = sharp(data, {
        raw: { width: info.width, height: info.height, channels: 4 },
      });
    }
    const buf = await input.png().toBuffer();
    composites.push({
      input: buf,
      left: Math.round((Number(t.left) || 0) - minL),
      top: Math.round((Number(t.top) || 0) - minT),
    });
  }

  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();

  return {
    left: minL,
    top: minT,
    width,
    height,
    buffer,
    paths: ordered.map((t) => t.path),
  };
}

/**
 * @param {string} jobDir
 * @param {{ templatesDir?: string }} [opts]
 */
export async function buildLoadingH5(jobDir, opts = {}) {
  const layersPath = path.join(jobDir, 'exports', 'layers.json');
  if (!fs.existsSync(layersPath)) {
    throw new Error('missing exports/layers.json');
  }
  const layers = JSON.parse(fs.readFileSync(layersPath, 'utf8'));
  const sceneEditPath = path.join(jobDir, 'scene-edit.json');
  const sceneEdit = fs.existsSync(sceneEditPath)
    ? JSON.parse(fs.readFileSync(sceneEditPath, 'utf8'))
    : null;

  const exportsDir = path.join(jobDir, 'exports');
  const outDir = path.join(jobDir, 'loading-h5');
  const assetsDir = path.join(outDir, 'assets');
  fs.rmSync(assetsDir, { recursive: true, force: true });
  fs.mkdirSync(assetsDir, { recursive: true });

  const buckets = {
    bg: [],
    fg: [],
    guide: [],
  };

  for (const tile of layers.tiles || []) {
    if (!isEffectivelyVisible(tile, sceneEdit)) continue;
    const { role, orient } = classifyPath(tile.path);
    const entry = { ...tile, orient, role };
    if (role === 'guide') {
      buckets.guide.push(entry);
      continue;
    }
    if (role === 'bg') buckets.bg.push(entry);
    else buckets.fg.push(entry);
  }

  const bgL = pickBest(buckets.bg, 'landscape');
  const bgP = pickBest(buckets.bg, 'portrait') || bgL;

  if (!bgL && !bgP) {
    throw new Error('no visible BG layer (path should contain 背景)');
  }

  const packLayout = (layout, encoded) => ({
    ...encoded,
    left: layout.left,
    top: layout.top,
    srcWidth: layout.width,
    srcHeight: layout.height,
  });

  const bgLandscape = bgL
    ? packLayout(
        { left: bgL.left, top: bgL.top, width: bgL.width, height: bgL.height },
        await encodeSingle(resolveTileFile(exportsDir, bgL), assetsDir, 'bg-landscape', {
          alpha: false,
        }),
      )
    : null;
  const bgPortrait = bgP
    ? packLayout(
        { left: bgP.left, top: bgP.top, width: bgP.width, height: bgP.height },
        await encodeSingle(resolveTileFile(exportsDir, bgP), assetsDir, 'bg-portrait', {
          alpha: false,
        }),
      )
    : bgLandscape;

  const fgL = await compositeForeground(exportsDir, buckets.fg, 'landscape');
  const fgP =
    (await compositeForeground(exportsDir, buckets.fg, 'portrait')) || fgL;

  const artLandscape = fgL
    ? packLayout(
        fgL,
        await encodeBuffer(fgL.buffer, assetsDir, 'art-landscape', { alpha: true }),
      )
    : null;
  const artPortrait = fgP
    ? packLayout(
        fgP,
        await encodeBuffer(fgP.buffer, assetsDir, 'art-portrait', { alpha: true }),
      )
    : artLandscape;

  const templatesDir =
    opts.templatesDir ||
    path.join(
      __dirname,
      '../../.cursor/skills/loading-h5-preview/templates',
    );
  const htmlTpl = fs.readFileSync(path.join(templatesDir, 'index.html'), 'utf8');
  const progressJs = fs.readFileSync(path.join(templatesDir, 'progress.js'), 'utf8');

  const title = String(layers.source || 'Loading').replace(/\.psd$/i, '');
  const pickUrl = (pack) => pack?.webp || '';

  const manifest = {
    version: LOADING_ASSET_PROFILE,
    assetProfile: LOADING_ASSET_PROFILE,
    title,
    canvas: { width: layers.width, height: layers.height },
    design: { long: 1120, short: 630 },
    maxEdge: MAX_EDGE,
    bg: {
      landscape: bgLandscape,
      portrait: bgPortrait,
    },
    art: {
      landscape: artLandscape,
      portrait: artPortrait,
    },
    bgLandscape: pickUrl(bgLandscape) || pickUrl(bgPortrait),
    bgPortrait: pickUrl(bgPortrait) || pickUrl(bgLandscape),
    artLandscape: pickUrl(artLandscape) || pickUrl(artPortrait) || '',
    artPortrait: pickUrl(artPortrait) || pickUrl(artLandscape) || '',
    roles: {
      bg: buckets.bg.map((t) => t.path),
      fg: buckets.fg.map((t) => t.path),
      fgComposite: {
        landscape: fgL?.paths || [],
        portrait: fgP?.paths || [],
      },
      guide: buckets.guide.map((t) => t.path),
    },
    builtAt: new Date().toISOString(),
  };

  let html = htmlTpl
    .replaceAll('{{TITLE}}', title)
    .replaceAll('{{BG_LANDSCAPE}}', manifest.bgLandscape)
    .replaceAll('{{BG_PORTRAIT}}', manifest.bgPortrait)
    .replaceAll('{{ART_LANDSCAPE}}', manifest.artLandscape || '')
    .replaceAll('{{ART_PORTRAIT}}', manifest.artPortrait || '')
    .replace('{{MANIFEST_JSON}}', JSON.stringify(manifest));

  fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
  fs.writeFileSync(path.join(outDir, 'progress.js'), progressJs, 'utf8');
  fs.writeFileSync(
    path.join(outDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  return { outDir, manifest };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const { jobDir } = parseArgs(process.argv);
  if (!jobDir) {
    console.error('Usage: node build-loading-h5.mjs --job-dir <path>');
    process.exit(2);
  }
  try {
    const r = await buildLoadingH5(jobDir);
    console.log(JSON.stringify({ ok: true, outDir: r.outDir, manifest: r.manifest }, null, 2));
  } catch (e) {
    console.error(e?.message || e);
    process.exit(1);
  }
}
