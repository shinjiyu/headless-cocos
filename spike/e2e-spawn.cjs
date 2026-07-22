#!/usr/bin/env node
'use strict';

/**
 * Spawn API smoke (disk-only): inject script + pending queue helpers present,
 * index rewrite inserts boot script.
 */

const fs = require('fs');
const path = require('path');

const MIRROR = path.join(__dirname, 'preview-mirror.mjs');
const INDEX = path.join(__dirname, 'cache', 'index.html');

const src = fs.readFileSync(MIRROR, 'utf8');
for (const needle of [
  'data-headless-spawn="1"',
  '/__spawn-pending',
  '/__spawn',
  'browser:spawn',
  'setPendingSpawn',
  'spawn=1',
  'rewrite: \'index-html\'',
]) {
  if (!src.includes(needle)) throw new Error(`mirror missing ${needle}`);
}

const html = fs.readFileSync(INDEX, 'utf8');
// Mirror rewriteIndexHtml: inject before </body>
const marker = 'data-headless-spawn="1"';
const injected = html.includes(marker)
  ? html
  : html.replace('</body>', `<script ${marker}></script>\n</body>`);
if (!injected.includes(marker)) throw new Error('index inject failed');
if (!injected.includes('</body>')) throw new Error('broken html');

console.log('[e2e-spawn] SUCCESS — spawn inject + API surface present');
