#!/usr/bin/env node
'use strict';

/**
 * Mint a Creator-shaped .meta when an asset or folder has none.
 *
 * Never rewrites a valid existing uuid — prefab/scene/script references
 * depend on it. Media importers still fill type-specific subMetas; this
 * covers JSON-sync types, scripts, atlas sidecars, and directory metas.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const UUID_RE = /^[0-9a-f-]{36}$/i;

/** Creator 3.8 defaults observed on a real PA project + official importers. */
const TEMPLATES = {
  '.prefab': {
    ver: '1.1.50',
    importer: 'prefab',
    files: ['.json'],
    userData(name) {
      return { syncNodeName: name };
    },
  },
  '.scene': {
    ver: '1.1.50',
    importer: 'scene',
    files: ['.json'],
  },
  '.anim': {
    ver: '1.0.0',
    importer: 'animation-clip',
    files: ['.json'],
  },
  '.animgraph': {
    ver: '1.0.0',
    importer: 'animation-graph',
    files: ['.json'],
  },
  '.mtl': {
    ver: '1.0.0',
    importer: 'material',
    files: ['.json'],
  },
  '.json': {
    ver: '2.0.1',
    importer: 'json',
    files: ['.json'],
  },
  '.ts': {
    ver: '4.0.24',
    importer: 'typescript',
    files: [],
  },
  '.js': {
    ver: '1.0.8',
    importer: 'javascript',
    files: [],
  },
  '.atlas': {
    ver: '1.0.0',
    importer: '*',
    files: ['.atlas', '.json'],
  },
};

const FOLDER_TEMPLATE = {
  ver: '1.2.0',
  importer: 'directory',
  files: [],
};

function readExistingUuid(metaPath) {
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    if (meta && UUID_RE.test(meta.uuid || '')) {
      return { uuid: meta.uuid, importer: meta.importer || null, meta };
    }
  } catch {}
  return null;
}

function writeMeta(metaPath, meta) {
  fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
}

function folderUserData(dirPath, assetsRoot) {
  if (!assetsRoot) return {};
  const abs = path.resolve(dirPath);
  const resources = path.resolve(assetsRoot, 'resources');
  if (abs === resources) {
    return {
      isBundle: true,
      bundleConfigID: 'default',
      bundleName: 'resources',
      priority: 8,
    };
  }
  return {};
}

/**
 * @param {string} dirPath
 * @param {{ assetsRoot?: string }} [opts]
 * @returns {{ uuid: string, minted: boolean, metaPath: string, importer: string } | null}
 */
function ensureFolderMeta(dirPath, opts = {}) {
  if (!dirPath || !fs.existsSync(dirPath)) return null;
  let st;
  try {
    st = fs.statSync(dirPath);
  } catch {
    return null;
  }
  if (!st.isDirectory()) return null;

  const metaPath = `${dirPath}.meta`;
  const existing = readExistingUuid(metaPath);
  if (existing) {
    return {
      uuid: existing.uuid,
      minted: false,
      metaPath,
      importer: existing.importer || FOLDER_TEMPLATE.importer,
    };
  }

  const uuid = crypto.randomUUID();
  const meta = {
    ver: FOLDER_TEMPLATE.ver,
    importer: FOLDER_TEMPLATE.importer,
    imported: true,
    uuid,
    files: FOLDER_TEMPLATE.files,
    subMetas: {},
    userData: folderUserData(dirPath, opts.assetsRoot),
  };
  writeMeta(metaPath, meta);
  return { uuid, minted: true, metaPath, importer: FOLDER_TEMPLATE.importer };
}

/**
 * Mint folder.meta for every ancestor from the file up through assetsRoot.
 * @returns {Array<{ uuid: string, minted: boolean, metaPath: string, dir: string }>}
 */
function ensureAncestorFolders(assetPath, assetsRoot) {
  if (!assetPath || !assetsRoot) return [];
  const root = path.resolve(assetsRoot);
  let dir = path.dirname(path.resolve(assetPath));
  const out = [];
  while (dir && dir.toLowerCase().startsWith(root.toLowerCase())) {
    const r = ensureFolderMeta(dir, { assetsRoot: root });
    if (r) out.push({ ...r, dir });
    if (path.resolve(dir).toLowerCase() === root.toLowerCase()) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return out;
}

/**
 * @param {string} assetPath absolute path of the source asset or folder
 * @param {{ assetsRoot?: string }} [opts]
 * @returns {{ uuid: string, minted: boolean, metaPath: string, importer: string } | null}
 */
function ensureAssetMeta(assetPath, opts = {}) {
  if (!assetPath || !fs.existsSync(assetPath)) return null;
  let st;
  try {
    st = fs.statSync(assetPath);
  } catch {
    return null;
  }
  if (st.isDirectory()) return ensureFolderMeta(assetPath, opts);

  const ext = path.extname(assetPath).toLowerCase();
  const spec = TEMPLATES[ext];
  if (!spec) return null;

  const metaPath = `${assetPath}.meta`;
  const existing = readExistingUuid(metaPath);
  if (existing) {
    if (opts.assetsRoot) ensureAncestorFolders(assetPath, opts.assetsRoot);
    return {
      uuid: existing.uuid,
      minted: false,
      metaPath,
      importer: existing.importer || spec.importer,
    };
  }

  const uuid = crypto.randomUUID();
  const name = path.basename(assetPath, ext);
  const meta = {
    ver: spec.ver,
    importer: spec.importer,
    imported: true,
    uuid,
    files: spec.files,
    subMetas: {},
    userData: spec.userData ? spec.userData(name) : {},
  };
  writeMeta(metaPath, meta);
  if (opts.assetsRoot) ensureAncestorFolders(assetPath, opts.assetsRoot);
  return { uuid, minted: true, metaPath, importer: spec.importer };
}

module.exports = {
  TEMPLATES,
  ensureAssetMeta,
  ensureFolderMeta,
  ensureAncestorFolders,
};
