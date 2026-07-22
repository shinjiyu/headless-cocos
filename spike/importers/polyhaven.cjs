#!/usr/bin/env node
'use strict';

/**
 * Lightweight Poly Haven model fetch for headless glTF import verification.
 *
 * Mirrors assetsSrcAPI `PolyHavenProvider` package selection (gltf @ resolution)
 * without taking a hard dependency on that package — same API endpoints.
 *
 *   api.polyhaven.com/assets?type=models
 *   api.polyhaven.com/files/{id}
 *   dl.polyhaven.org/...
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const DEFAULT_API = 'https://api.polyhaven.com';
const DEFAULT_UA = 'headless-cocos/polyhaven (+https://github.com/shinjiyu/headless-cocos)';

async function getJson(url, { userAgent } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': userAgent || DEFAULT_UA },
  });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json();
}

async function downloadFile(url, dest, { userAgent } = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  const res = await fetch(url, {
    headers: { 'User-Agent': userAgent || DEFAULT_UA },
  });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const tmp = `${dest}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, dest);
  return dest;
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function asFile(value) {
  const r = asRecord(value);
  if (!r || typeof r.url !== 'string') return undefined;
  return {
    url: r.url,
    size: typeof r.size === 'number' ? r.size : undefined,
    include: asRecord(r.include) || {},
  };
}

function fileNameFromUrl(url) {
  try {
    return path.basename(new URL(url).pathname);
  } catch {
    return path.basename(url);
  }
}

/**
 * Select glTF package files at the given resolution (default 1k).
 * @returns {{ relativePath: string, url: string, size?: number }[]}
 */
function selectGltfPackage(fileTree, resolution = '1k') {
  const root = asRecord(fileTree.gltf);
  const byRes = asRecord(root?.[resolution]);
  const main = asFile(byRes?.gltf);
  if (!main) {
    throw new Error(`No gltf@${resolution} package in Poly Haven file tree`);
  }
  const files = [{ relativePath: fileNameFromUrl(main.url), url: main.url, size: main.size }];
  for (const [rel, dep] of Object.entries(main.include)) {
    const f = asFile(dep);
    if (!f) continue;
    const safe = rel.replace(/\\/g, '/').replace(/^\/+/, '');
    files.push({ relativePath: safe, url: f.url, size: f.size });
  }
  return files;
}

/** List Poly Haven models (optionally filtered by polycount). */
async function listModels(options = {}) {
  const api = (options.apiBaseUrl || DEFAULT_API).replace(/\/$/, '');
  const all = await getJson(`${api}/assets?type=models`, options);
  let rows = Object.entries(all).map(([id, info]) => ({
    id,
    name: info.name,
    polycount: info.polycount || 0,
    downloads: info.download_count || 0,
    categories: info.categories || [],
  }));
  if (options.maxPoly != null) rows = rows.filter((r) => r.polycount > 0 && r.polycount <= options.maxPoly);
  if (options.minPoly != null) rows = rows.filter((r) => r.polycount >= options.minPoly);
  rows.sort((a, b) => a.polycount - b.polycount || b.downloads - a.downloads);
  if (options.limit) rows = rows.slice(0, options.limit);
  return rows;
}

/**
 * Download a Poly Haven model glTF package into destDir.
 * @returns {{ assetId, destDir, entryGltf, files: string[], info }}
 */
async function fetchModel(assetId, destDir, options = {}) {
  const api = (options.apiBaseUrl || DEFAULT_API).replace(/\/$/, '');
  const resolution = options.resolution || '1k';
  fs.mkdirSync(destDir, { recursive: true });

  const info = await getJson(`${api}/info/${encodeURIComponent(assetId)}`, options);
  const tree = await getJson(`${api}/files/${encodeURIComponent(assetId)}`, options);
  const selected = selectGltfPackage(tree, resolution);

  const written = [];
  let entryGltf = null;
  for (const file of selected) {
    const dest = path.join(destDir, file.relativePath);
    await downloadFile(file.url, dest, options);
    written.push(dest);
    if (/\.gltf$/i.test(file.relativePath)) entryGltf = dest;
  }
  if (!entryGltf) throw new Error(`No .gltf entry in package for ${assetId}`);

  // Stable meta so reimports keep a uuid
  const metaPath = `${entryGltf}.meta`;
  if (!fs.existsSync(metaPath)) {
    fs.writeFileSync(
      metaPath,
      JSON.stringify(
        {
          ver: '2.3.14',
          importer: 'gltf',
          imported: false,
          uuid: crypto.randomUUID(),
          files: [],
          subMetas: {},
          userData: {
            polyhavenId: assetId,
            polyhavenName: info.name,
            resolution,
            sourceUrl: `https://polyhaven.com/a/${encodeURIComponent(assetId)}`,
            license: 'CC0-1.0',
          },
        },
        null,
        2,
      ),
    );
  }

  return {
    assetId,
    destDir,
    entryGltf,
    files: written,
    info: {
      name: info.name,
      polycount: info.polycount,
      categories: info.categories,
    },
    resolution,
  };
}

/** Convenience: fetch into a temp (or cache) dir under os.tmpdir(). */
async function fetchModelCached(assetId, options = {}) {
  const cacheRoot =
    options.cacheDir || path.join(os.tmpdir(), 'headless-cocos-polyhaven');
  const destDir = path.join(cacheRoot, assetId, options.resolution || '1k');
  return fetchModel(assetId, destDir, options);
}

module.exports = {
  DEFAULT_API,
  listModels,
  fetchModel,
  fetchModelCached,
  selectGltfPackage,
};
