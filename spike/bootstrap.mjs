#!/usr/bin/env node
/**
 * New-user bootstrap: check the pinned runtime, create a project, print run cmd.
 * Does not install or invoke Cocos Creator.
 *
 *   node spike/bootstrap.mjs --out D:\tempWorkspace\my-game
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { kitStatus, kitMissingHelp } = require('./runtime-kit.cjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const out = { dest: '', name: '', template: 'base-ai' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') out.dest = argv[++i];
    else if (a === '--name') out.name = argv[++i];
    else if (a === '--template') out.template = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
    else if (!a.startsWith('-') && !out.dest) out.dest = a;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.dest) {
    process.stdout.write(
      'Create a headless Cocos project and verify the 3.8.8 runtime kit.\n\n' +
        '  node spike/bootstrap.mjs --out D:\\tempWorkspace\\my-game\n' +
        '  node spike/bootstrap.mjs --template base-ai-3d --out D:\\tempWorkspace\\my-game\n',
    );
    if (!args.dest) process.exit(args.help ? 0 : 1);
    return;
  }

  const st = kitStatus({ repoRoot: REPO });
  if (!st.ready) {
    process.stderr.write(`${kitMissingHelp(REPO)}\n`);
    process.exit(2);
  }

  const created = spawnSync(
    process.execPath,
    [
      path.join(__dirname, 'create-project.mjs'),
      '--template',
      args.template || 'base-ai',
      '--out',
      path.resolve(args.dest),
      ...(args.name ? ['--name', args.name] : []),
    ],
    { cwd: REPO, encoding: 'utf8' },
  );
  if (created.status !== 0) {
    process.stderr.write(created.stderr || created.stdout);
    process.exit(created.status || 1);
  }

  const dest = path.resolve(args.dest);
  process.stdout.write(created.stdout);
  process.stdout.write(
    [
      '',
      'Runtime kit ready. Start preview (no Creator):',
      '',
      `  $env:PACKER="mini"`,
      `  $env:PROJECT="${dest}"`,
      '  node spike/preview-mirror.mjs',
      '',
      'Then open http://127.0.0.1:7460/',
      '',
    ].join('\n'),
  );
}

main();
