#!/usr/bin/env node
'use strict';

/**
 * Create from the headless baseAIAutoCocos shell (no MCP).
 * Does not start Creator or preview.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const REPO = path.resolve(__dirname, '..');
const TEMPLATE = path.join(REPO, 'templates/base-ai-headless');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'base-ai-headless-'));

function exists(rel) {
  return fs.existsSync(path.join(OUT, rel));
}

(async () => {
  if (!fs.existsSync(path.join(TEMPLATE, 'package.json'))) {
    const pack = spawnSync(process.execPath, [path.join(__dirname, 'pack-base-ai-headless.mjs')], {
      cwd: REPO,
      encoding: 'utf8',
    });
    if (pack.status !== 0) {
      throw new Error(`pack failed: ${pack.stderr || pack.stdout}`);
    }
  }

  const created = spawnSync(
    process.execPath,
    [path.join(__dirname, 'create-project.mjs'), '--template', 'base-ai', '--out', OUT, '--force', '--name', 'e2e-headless'],
    { cwd: REPO, encoding: 'utf8' },
  );
  if (created.status !== 0) {
    throw new Error(`create-project failed: ${created.stderr || created.stdout}`);
  }
  const info = JSON.parse(created.stdout);
  assert.equal(info.ok, true);
  assert.equal(info.template, 'base-ai');
  assert.equal(info.mcp, false);

  assert.ok(exists('assets/scene/PreviewBoot.scene'), 'boot scene');
  assert.ok(exists('assets/resources.meta'), 'resources bundle meta');
  assert.ok(exists('settings/v2/packages/engine.json'), 'engine settings');
  assert.ok(exists('extensions/viewweaver/src/cli.ts'), 'ViewWeaver CLI');
  assert.ok(!exists('extensions/cocos-meta-mcp'), 'MCP extension must be absent');
  assert.ok(!exists('.cursor/skills/cocos-meta-mcp-recipes'), 'MCP recipes skill must be absent');
  assert.ok(!exists('.cursor/skills/creator-preview-refresh'), 'Creator preview skill must be absent');

  const scene = JSON.parse(fs.readFileSync(path.join(OUT, 'assets/scene/PreviewBoot.scene'), 'utf8'));
  const names = scene.map((o) => o && o._name).filter(Boolean);
  assert.ok(names.includes('Canvas'), 'Canvas');
  assert.ok(names.includes('Camera'), 'Camera');
  assert.ok(!names.includes('HeroSprite'), 'no e2e HeroSprite');
  assert.ok(!names.includes('HeadlessProbe'), 'no HeadlessProbe node');
  assert.ok(
    !scene.some((o) => o && o.__type__ === '6bfb5n25yxKvrVUsXF25j4d'),
    'no HeadlessProbe component',
  );

  const pkg = JSON.parse(fs.readFileSync(path.join(OUT, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'e2e-headless');
  assert.ok(pkg.uuid && pkg.uuid !== 'ebc6b024-7ddc-4090-abcc-adc1b0217e2d');

  const host = await import(pathToFileURL(path.join(__dirname, 'viewweaver-host.mjs')).href);
  const st = host.status(OUT);
  assert.ok(st.available, `ViewWeaver unavailable: ${JSON.stringify(st)}`);
  assert.equal(st.tool, 'viewweaver');

  const agents = fs.readFileSync(path.join(OUT, 'AGENTS.md'), 'utf8');
  assert.match(agents, /no MCP/i);
  assert.match(agents, /__viewweaver/);

  console.log('[e2e-create-project] SUCCESS', {
    out: OUT,
    files: info.files,
    tool: st.tool,
    sceneNodes: names,
  });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
