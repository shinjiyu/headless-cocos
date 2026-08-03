/**
 * 从 layers.json + tiles 生成 loading-h5/（纯 H5 Splash，无 Cocos）。
 * BG/原画：整图不切块；统一同一长边档位导出 WebP（+ AVIF），不区分 S/M/L。
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
  if (/原画|原畫|logo|title/i.test(s)) return { role: 'art', orient };
  if (/进度|進度|progress/i.test(s)) return { role: 'progress', orient };
  return { role: 'other', orient };
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
async function encodeSingle(srcPath, assetsDir, baseName, { alpha }) {
  const meta = await sharp(srcPath).metadata();
  const srcW = meta.width || 1;
  const srcH = meta.height || 1;
  const long = Math.max(srcW, srcH);
  const target = Math.min(MAX_EDGE, long);
  const scale = target / long;
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));

  const webpName = `${baseName}.webp`;
  await sharp(srcPath)
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
    await sharp(srcPath)
      .resize({ width, height, fit: 'fill', withoutEnlargement: true })
      .avif({ quality: AVIF_QUALITY, effort: 4 })
      .toFile(path.join(assetsDir, avifName));
    out.avif = `./assets/${avifName}`;
  } catch {
    /* AVIF optional */
  }

  return out;
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
    art: [],
    progress: [],
    other: [],
  };

  for (const tile of layers.tiles || []) {
    if (!isEffectivelyVisible(tile, sceneEdit)) continue;
    const { role, orient } = classifyPath(tile.path);
    if (role === 'guide') continue;
    const entry = { ...tile, orient, role };
    if (buckets[role]) buckets[role].push(entry);
    else buckets.other.push(entry);
  }

  const bgL = pickBest(buckets.bg, 'landscape');
  const bgP = pickBest(buckets.bg, 'portrait') || bgL;
  const artL = pickBest(buckets.art, 'landscape');
  const artP = pickBest(buckets.art, 'portrait') || artL;

  if (!bgL && !bgP) {
    throw new Error('no visible BG layer (path should contain 背景)');
  }

  const packLayout = (tile, encoded) => ({
    ...encoded,
    left: tile.left,
    top: tile.top,
    srcWidth: tile.width,
    srcHeight: tile.height,
  });

  const bgLandscape = bgL
    ? packLayout(
        bgL,
        await encodeSingle(resolveTileFile(exportsDir, bgL), assetsDir, 'bg-landscape', {
          alpha: false,
        }),
      )
    : null;
  const bgPortrait = bgP
    ? packLayout(
        bgP,
        await encodeSingle(resolveTileFile(exportsDir, bgP), assetsDir, 'bg-portrait', {
          alpha: false,
        }),
      )
    : bgLandscape;
  const artLandscape = artL
    ? packLayout(
        artL,
        await encodeSingle(resolveTileFile(exportsDir, artL), assetsDir, 'art-landscape', {
          alpha: true,
        }),
      )
    : null;
  const artPortrait = artP
    ? packLayout(
        artP,
        await encodeSingle(resolveTileFile(exportsDir, artP), assetsDir, 'art-portrait', {
          alpha: true,
        }),
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
    // 对齐 AspectRatioAdapter9to16 / BgPlus 安全区
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
      art: buckets.art.map((t) => t.path),
      progress: buckets.progress.map((t) => t.path),
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
