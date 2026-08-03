/**
 * PSD → layers.json + tiles/*.png（供 H5 叠图预览）
 * 逻辑对齐 amadues-publish/scripts/psd-h5-export.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from 'canvas';
import { readPsd, initializeCanvas } from 'ag-psd';

let canvasReady = false;

function ensureCanvas() {
  if (canvasReady) return;
  initializeCanvas(createCanvas);
  canvasReady = true;
}

function tileFileName(index1Based) {
  return `tile_${String(index1Based).padStart(5, '0')}`;
}

/**
 * 自底向上遍历；组写入 onGroup，叶子写入 onLeaf。
 * ancestorHidden = 路径上任意父组 hidden。
 * @param {object} root
 * @param {{
 *   onLeaf?: (layer: object, pathParts: string[], ancestorHidden: boolean) => void,
 *   onGroup?: (info: { path: string, name: string, hidden: boolean }) => void,
 * }} hooks
 */
function walkWithPath(root, hooks = {}) {
  const onLeaf = hooks.onLeaf || (() => {});
  const onGroup = hooks.onGroup || (() => {});

  function rec(layer, parts, ancestorHidden) {
    const name = layer.name || '(unnamed)';
    const ch = layer.children;
    if (ch?.length) {
      const groupPath = parts.length ? [...parts, name].join('/') : name;
      const hidden = !!layer.hidden;
      onGroup({ path: groupPath, name, hidden });
      const nextHidden = ancestorHidden || hidden;
      for (let i = ch.length - 1; i >= 0; i--) {
        rec(ch[i], [...parts, name], nextHidden);
      }
      return;
    }
    onLeaf(layer, parts, ancestorHidden);
  }

  const ch = root.children;
  if (!ch?.length) {
    onLeaf(root, [], false);
    return;
  }
  for (let i = ch.length - 1; i >= 0; i--) {
    rec(ch[i], [], false);
  }
}

/**
 * @param {string} psdPath
 * @param {string} outDir  e.g. jobs/{id}/exports
 * @param {{
 *   maxTiles?: number,
 *   onProgress?: (msg: string) => void,
 *   sourceLabel?: string,
 * }} [opts]
 */
export function exportPsdTiles(psdPath, outDir, opts = {}) {
  ensureCanvas();
  const maxTiles = opts.maxTiles ?? 0;
  const log = opts.onProgress || (() => {});

  if (!fs.existsSync(psdPath)) {
    throw new Error(`PSD not found: ${psdPath}`);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const tilesDir = path.join(outDir, 'tiles');
  if (fs.existsSync(tilesDir)) {
    fs.rmSync(tilesDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tilesDir, { recursive: true });

  log(`reading ${psdPath}`);
  const buffer = fs.readFileSync(psdPath);
  log(`buffer ${buffer.length} bytes; parsing…`);

  const psd = readPsd(buffer, {
    skipLayerImageData: false,
    skipCompositeImageData: true,
    skipThumbnail: true,
    skipLinkedFilesData: true,
  });

  const tiles = [];
  const groupMap = new Map();
  let idx = 0;
  let skipped = 0;

  walkWithPath(psd, {
    onGroup(info) {
      if (!groupMap.has(info.path)) {
        groupMap.set(info.path, {
          path: info.path,
          name: info.name,
          hidden: !!info.hidden,
        });
      }
    },
    onLeaf(layer, pathParts, ancestorHidden) {
      if (maxTiles > 0 && idx >= maxTiles) {
        skipped += 1;
        return;
      }

      const left = layer.left ?? 0;
      const top = layer.top ?? 0;
      const right = layer.right ?? left;
      const bottom = layer.bottom ?? top;
      const width = Math.max(0, right - left);
      const height = Math.max(0, bottom - top);
      const leafName = layer.name ?? '(unnamed)';
      const pathStr = pathParts.length
        ? [...pathParts, leafName].join('/')
        : leafName;

      if (!(width > 0 && height > 0)) return;

      idx += 1;
      const idBase = tileFileName(idx);
      const fileName = `${idBase}.png`;
      const relPath = `tiles/${fileName}`;
      const hasCanvas = layer.canvas && typeof layer.canvas.toBuffer === 'function';

      let exported = false;
      if (hasCanvas) {
        try {
          const png = layer.canvas.toBuffer('image/png');
          fs.writeFileSync(path.join(tilesDir, fileName), png);
          exported = true;
        } catch (e) {
          log(`[warn] export fail ${pathStr}: ${e?.message || e}`);
        }
      } else {
        log(`[warn] no raster: ${pathStr}`);
      }

      const selfHidden = !!layer.hidden;
      tiles.push({
        index: idx - 1,
        id: idBase,
        path: pathStr,
        file: exported ? relPath : null,
        left,
        top,
        width,
        height,
        hidden: selfHidden,
        effectiveHidden: ancestorHidden || selfHidden,
        opacity: layer.opacity ?? 1,
        blendMode: layer.blendMode || 'normal',
      });
    },
  });

  if (skipped > 0) {
    log(`maxTiles=${maxTiles}: skipped ${skipped} extra leaves`);
  }

  const groups = Array.from(groupMap.values()).sort((a, b) =>
    a.path.localeCompare(b.path),
  );

  const manifest = {
    mode: 'tiles',
    parser: 'ag-psd',
    stacking: {
      tileOrder: 'bottom-to-top',
      zIndexAsc:
        '默认预览用 z-index = maxIndex - tileIndex，使大索引（常是 BG）在下层',
    },
    source: opts.sourceLabel || psdPath,
    width: psd.width,
    height: psd.height,
    channels: psd.channels,
    bitsPerChannel: psd.bitsPerChannel,
    colorMode: psd.colorMode,
    tileCount: tiles.filter((t) => t.file).length,
    groups,
    tiles,
    truncated: skipped > 0,
    maxTiles: maxTiles || null,
  };

  const layersPath = path.join(outDir, 'layers.json');
  fs.writeFileSync(layersPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  log(`wrote ${layersPath} (${manifest.tileCount} PNG, ${groups.length} groups)`);
  return manifest;
}
