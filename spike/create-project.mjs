#!/usr/bin/env node
/**
 * Create a Creator 3.8 project by copying a known-good template.
 *
 * Headless preview cannot invent settings/ + launch scene. A template already
 * has those; after copy, mint-meta / ViewWeaver / HMR can grow the project.
 *
 *   node spike/create-project.mjs --list
 *   node spike/create-project.mjs --template base-ai --out D:\tempWorkspace\my-game
 *   node spike/create-project.mjs --from D:\path\to\existing --out D:\new-game
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

const SKIP_DIR = new Set([
  'library',
  'temp',
  'node_modules',
  '.git',
  'docker-workspace',
  'work',
  'results',
  '.evolve',
  '.ai-workspace',
  '.cocosmcp',
]);

const MCP_DIRS = [
  'extensions/cocos-meta-mcp',
  '.cursor/skills/cocos-meta-mcp-recipes',
  '.cursor/skills/cocos-meta-mcp-scene',
  '.cursor/skills/creator-preview-refresh',
  '.cursor/skills/creator-console-log',
  '.cursor/skills/creator-scene-editing',
];

function resolveBaseAiDir() {
  const sibling = path.resolve(REPO, '../baseAIAutoCocos-headless');
  if (
    fs.existsSync(path.join(sibling, 'assets/scene/PreviewBoot.scene')) &&
    fs.existsSync(path.join(sibling, 'extensions/viewweaver/src/cli.ts'))
  ) {
    return sibling;
  }
  return path.join(REPO, 'templates/base-ai-headless');
}

const TEMPLATES = {
  'base-ai': {
    dir: resolveBaseAiDir(),
    note: 'baseAIAutoCocos headless: ViewWeaver + boot scene, no MCP. Default.',
    stripMcp: true,
  },
  'pa-mini': {
    dir: path.join(REPO, 'harness-bench/templates/pa-mini'),
    note: 'Harness-only thin PA (MainUI/CTA). Not the default create shell.',
  },
  'base-pa': {
    dir: path.join(REPO, 'harness-bench/templates/base-pa'),
    note: 'Harness-only full AIWS PA copy (~17MB).',
  },
};

function parseArgs(argv) {
  const out = {
    template: 'base-ai',
    from: '',
    dest: '',
    list: false,
    force: false,
    name: '',
    noMcp: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') out.list = true;
    else if (a === '--template') out.template = argv[++i];
    else if (a === '--from') out.from = argv[++i];
    else if (a === '--out') out.dest = argv[++i];
    else if (a === '--name') out.name = argv[++i];
    else if (a === '--force') out.force = true;
    else if (a === '--no-mcp') out.noMcp = true;
    else if (a === '-h' || a === '--help') out.help = true;
    else if (!a.startsWith('-') && !out.dest) out.dest = a;
  }
  return out;
}

function looksLikeCocosRoot(dir) {
  return (
    fs.existsSync(path.join(dir, 'assets')) &&
    fs.existsSync(path.join(dir, 'settings')) &&
    fs.existsSync(path.join(dir, 'package.json'))
  );
}

function copyTree(src, dest) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    if (SKIP_DIR.has(path.basename(src))) return { files: 0, skipped: 1 };
    fs.mkdirSync(dest, { recursive: true });
    let files = 0;
    let skipped = 0;
    for (const name of fs.readdirSync(src)) {
      const r = copyTree(path.join(src, name), path.join(dest, name));
      files += r.files;
      skipped += r.skipped;
    }
    return { files, skipped };
  }
  fs.copyFileSync(src, dest);
  return { files: 1, skipped: 0 };
}

function stripMcpTree(dest) {
  let removed = 0;
  for (const rel of MCP_DIRS) {
    const abs = path.join(dest, rel);
    if (!fs.existsSync(abs)) continue;
    fs.rmSync(abs, { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

function retitle(dest, name) {
  const pkgPath = path.join(dest, 'package.json');
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch {
    return;
  }
  if (name) pkg.name = name;
  pkg.uuid = crypto.randomUUID();
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

function printHelp() {
  const rows = Object.entries(TEMPLATES)
    .map(([id, t]) => `  ${id.padEnd(10)} ${t.note}`)
    .join('\n');
  process.stdout.write(
    [
      'Create a Cocos 3.8 project from a template (no Creator IDE).',
      '',
      'Usage:',
      '  node spike/create-project.mjs --template base-ai --out <dir>',
      '  node spike/create-project.mjs --from <existing-project> --out <dir> [--no-mcp]',
      '  node spike/create-project.mjs --list',
      '',
      'Templates:',
      rows,
      '',
    ].join('\n'),
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args.list) {
    for (const [id, t] of Object.entries(TEMPLATES)) {
      const ok = looksLikeCocosRoot(t.dir);
      process.stdout.write(`${id}\t${ok ? 'ready' : 'MISSING'}\t${t.dir}\n`);
    }
    return;
  }

  const src = args.from
    ? path.resolve(args.from)
    : TEMPLATES[args.template]?.dir;
  if (!src) {
    throw new Error(`unknown template: ${args.template} (use --list)`);
  }
  if (!looksLikeCocosRoot(src)) {
    throw new Error(`not a Creator 3.8 project (need assets/ + settings/ + package.json): ${src}`);
  }
  if (!args.dest) throw new Error('missing --out <dir>');
  const dest = path.resolve(args.dest);
  if (fs.existsSync(dest) && fs.readdirSync(dest).length && !args.force) {
    throw new Error(`refusing to write into non-empty ${dest} (pass --force)`);
  }

  fs.mkdirSync(dest, { recursive: true });
  const stats = copyTree(src, dest);
  const stripMcp = args.noMcp || Boolean(TEMPLATES[args.template]?.stripMcp);
  if (stripMcp) stripMcpTree(dest);
  const name = args.name || path.basename(dest);
  retitle(dest, name);
  if (!looksLikeCocosRoot(dest)) {
    throw new Error(`copy finished but dest is not a valid project: ${dest}`);
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      template: args.from ? 'from' : args.template,
      from: src,
      out: dest,
      name,
      files: stats.files,
      skippedDirs: stats.skipped,
      mcp: stripMcp ? false : undefined,
    }, null, 2)}\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    process.stderr.write(`[create-project] ${e.message || e}\n`);
    process.exit(1);
  }
}

export { TEMPLATES, looksLikeCocosRoot, copyTree, stripMcpTree };
