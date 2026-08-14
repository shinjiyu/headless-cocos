#!/usr/bin/env node
'use strict';

/**
 * Headless ViewWeaver host: resolve project CLI + dry-run CTA.
 * Does not start Creator.
 */

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const PROJECT = path.resolve(__dirname, '../../dsh-cocos-test');

(async () => {
  const host = await import(pathToFileURL(path.join(__dirname, 'viewweaver-host.mjs')).href);
  const st = host.status(PROJECT);
  assert.ok(st.available, `CLI missing in ${PROJECT}: ${JSON.stringify(st)}`);
  assert.ok(st.prefabs.includes('CTA'), `CTA not in registry: ${st.prefabs}`);
  assert.ok(st.prefabs.includes('MainUI'));

  const abs = host.resolvePrefabAbs(PROJECT, 'CTA');
  assert.ok(abs && abs.endsWith('CTA.prefab'));

  const byPath = host.resolvePrefabAbs(PROJECT, 'assets/resources/prefab/CTA.prefab');
  assert.equal(byPath, abs);

  const hit = host.matchRegistryAsset(PROJECT, 'assets/resources/prefab/CTA.prefab');
  assert.equal(hit.prefabName, 'CTA');
  assert.equal(
    host.matchRegistryAsset(PROJECT, 'assets/scripts/_genbot/CTA/CTA.bind.json').prefabName,
    'CTA',
  );
  assert.equal(host.matchRegistryAsset(PROJECT, 'assets/scripts/_genbot/CTA/CTA.gen.ts'), null);

  const dry = await host.generatePrefab(PROJECT, 'CTA', { dryRun: true });
  assert.ok(dry.ok, dry.error || dry.log);
  assert.equal(dry.tool, 'genbot');

  console.log('[e2e-viewweaver] SUCCESS', {
    tool: st.tool,
    cli: st.cli,
    prefabs: st.prefabs,
    dryPrefab: dry.prefab,
  });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
