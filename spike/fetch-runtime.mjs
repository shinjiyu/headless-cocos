#!/usr/bin/env node
/**
 * Download the pinned runtime zip. Never asks the user to install Creator.
 *
 *   $env:HEADLESS_RUNTIME_URL="https://example/headless-runtime-3.8.8.zip"
 *   node spike/fetch-runtime.mjs
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ENGINE_VERSION, kitDir, kitStatus, kitMissingHelp } = require('./runtime-kit.cjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

async function main() {
  const url = process.env.HEADLESS_RUNTIME_URL || '';
  const dest = kitDir(REPO);
  if (!url) {
    process.stderr.write(`${kitMissingHelp(REPO)}\n`);
    process.stderr.write('Set HEADLESS_RUNTIME_URL to a zip of runtime/3.8.8.\n');
    process.exit(1);
  }

  fs.mkdirSync(dest, { recursive: true });
  const zip = path.join(REPO, 'dist', `headless-runtime-${ENGINE_VERSION}.zip`);
  fs.mkdirSync(path.dirname(zip), { recursive: true });
  process.stdout.write(`GET ${url}\n`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} ${url}`);
  fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));

  if (process.platform === 'win32') {
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -Force -Path '${zip}' -DestinationPath '${dest}'`,
      ],
      { stdio: 'inherit' },
    );
  } else {
    execFileSync('unzip', ['-o', zip, '-d', dest], { stdio: 'inherit' });
  }

  const st = kitStatus({ repoRoot: REPO });
  if (!st.ready) throw new Error(`unzipped but kit not ready: ${JSON.stringify(st)}`);
  process.stdout.write(`${JSON.stringify({ ok: true, ...st }, null, 2)}\n`);
}

main().catch((e) => {
  process.stderr.write(`[fetch-runtime] ${e.message || e}\n`);
  process.exit(1);
});
