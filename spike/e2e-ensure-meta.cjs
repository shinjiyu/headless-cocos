#!/usr/bin/env node
'use strict';

/**
 * Unit: mint .meta for prefab / scene / ts / json / atlas / folders.
 * Does not start preview or Creator.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  ensureAssetMeta,
  ensureFolderMeta,
  ensureAncestorFolders,
} = require('./importers/ensure-meta.cjs');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ensure-meta-'));
const ASSETS = path.join(DIR, 'assets');

function write(rel, body) {
  const abs = path.join(ASSETS, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  return abs;
}

try {
  const prefab = write('Hero.prefab', JSON.stringify([{ __type__: 'cc.Prefab', _name: 'Hero' }]));
  const first = ensureAssetMeta(prefab, { assetsRoot: ASSETS });
  assert.ok(first && first.minted, 'prefab should mint');
  assert.equal(first.importer, 'prefab');
  assert.match(first.uuid, /^[0-9a-f-]{36}$/i);
  const prefabMeta = JSON.parse(fs.readFileSync(`${prefab}.meta`, 'utf8'));
  assert.equal(prefabMeta.userData.syncNodeName, 'Hero');
  assert.deepEqual(prefabMeta.files, ['.json']);

  const again = ensureAssetMeta(prefab, { assetsRoot: ASSETS });
  assert.equal(again.minted, false);
  assert.equal(again.uuid, first.uuid, 'must not rotate existing prefab uuid');

  const scene = write('Boot.scene', JSON.stringify([{ __type__: 'cc.SceneAsset' }]));
  const sc = ensureAssetMeta(scene, { assetsRoot: ASSETS });
  assert.ok(sc.minted);
  assert.equal(sc.importer, 'scene');

  const ts = write('scripts/NewTool.ts', 'export const n = 1;\n');
  const script = ensureAssetMeta(ts, { assetsRoot: ASSETS });
  assert.ok(script.minted);
  assert.equal(script.importer, 'typescript');
  const tsMeta = JSON.parse(fs.readFileSync(`${ts}.meta`, 'utf8'));
  assert.deepEqual(tsMeta.files, []);
  assert.equal(ensureAssetMeta(ts).uuid, script.uuid);
  assert.ok(fs.existsSync(path.join(ASSETS, 'scripts.meta')), 'script parent folder meta');

  const json = write('cfg/data.json', '{"ok":true}');
  const cfg = ensureAssetMeta(json, { assetsRoot: ASSETS });
  assert.ok(cfg.minted);
  assert.equal(cfg.importer, 'json');

  const atlas = write('fx/pack/hero.atlas', 'hero.png\nsize: 8,8\n');
  const at = ensureAssetMeta(atlas, { assetsRoot: ASSETS });
  assert.ok(at.minted);
  assert.equal(at.importer, '*');
  assert.ok(fs.existsSync(path.join(ASSETS, 'fx.meta')));
  assert.ok(fs.existsSync(path.join(ASSETS, 'fx', 'pack.meta')));

  const nested = write('fx/harexplore/legendwin/a.prefab', '[]');
  ensureAncestorFolders(nested, ASSETS);
  const hare = JSON.parse(fs.readFileSync(path.join(ASSETS, 'fx', 'harexplore.meta'), 'utf8'));
  assert.equal(hare.importer, 'directory');
  assert.deepEqual(hare.userData, {}, 'random folders are not bundles');

  fs.mkdirSync(path.join(ASSETS, 'resources'), { recursive: true });
  const res = ensureFolderMeta(path.join(ASSETS, 'resources'), { assetsRoot: ASSETS });
  assert.ok(res.minted);
  const resMeta = JSON.parse(fs.readFileSync(path.join(ASSETS, 'resources.meta'), 'utf8'));
  assert.equal(resMeta.userData.isBundle, true);
  assert.equal(resMeta.userData.bundleName, 'resources');
  assert.equal(ensureFolderMeta(path.join(ASSETS, 'resources'), { assetsRoot: ASSETS }).uuid, res.uuid);

  const png = write('icon.png', 'not-a-real-png');
  assert.equal(ensureAssetMeta(png), null, 'media types stay with their own importers');

  const missing = ensureAssetMeta(path.join(ASSETS, 'nope.prefab'));
  assert.equal(missing, null);

  console.log('[e2e-ensure-meta] SUCCESS', {
    prefab: first.uuid,
    scene: sc.uuid,
    ts: script.uuid,
    json: cfg.uuid,
    atlas: at.uuid,
    resources: res.uuid,
  });
} finally {
  fs.rmSync(DIR, { recursive: true, force: true });
}
