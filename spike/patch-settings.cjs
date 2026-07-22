#!/usr/bin/env node
/** Patch cached settings.js for headless mirror boot experiments. */
const fs = require('fs');
const path = require('path');

const settingsPath = path.join(__dirname, 'cache', 'settings.js');
const uuid = '23ed0669-5d4b-4089-9483-04ac7220ee5a';
const mode = process.argv[2] || 'launch';

let s = fs.readFileSync(settingsPath, 'utf8');
const m = s.match(/window\._CCSettings\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
if (!m) {
  console.error('cannot parse _CCSettings');
  process.exit(1);
}
const settings = JSON.parse(m[1]);

if (mode === 'launch' || mode === 'simple') {
  settings.launch = settings.launch || {};
  settings.launch.launchScene = uuid;
}
if (mode === 'simple') {
  // Drop project-specific custom pipeline so splash/UI can bind default passes.
  settings.engine = settings.engine || {};
  settings.engine.macros = {};
  settings.engine.customLayers = settings.engine.customLayers || [];
  // Prefer modules closer to a stock web-desktop preview.
  if (Array.isArray(settings.engine.engineModules)) {
    settings.engine.engineModules = settings.engine.engineModules.filter(
      (x) => x !== 'custom-pipeline-post-process'
    );
    if (!settings.engine.engineModules.includes('custom-pipeline-builtin-scripts')) {
      settings.engine.engineModules.push('custom-pipeline-builtin-scripts');
    }
  }
  settings.rendering = settings.rendering || {};
  settings.rendering.customPipeline = true;
  settings.rendering.renderPipeline = '';
  // Avoid missing resources/Sound bundles if their configs aren't snapshotted yet.
  settings.assets = settings.assets || {};
  settings.assets.preloadBundles = [{ bundle: 'main' }];
  settings.assets.projectBundles = ['internal', 'main'];
}

const out = 'window._CCSettings = ' + JSON.stringify(settings) + ';';
fs.writeFileSync(settingsPath, out);
console.log('mode=', mode);
console.log('launchScene=', settings.launch.launchScene);
console.log('macros=', JSON.stringify(settings.engine.macros));
console.log('preload=', JSON.stringify(settings.assets.preloadBundles));
console.log('modules has builtin=', settings.engine.engineModules.includes('custom-pipeline-builtin-scripts'));
console.log('len=', out.length);
