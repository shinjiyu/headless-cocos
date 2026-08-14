#!/usr/bin/env node
/**
 * Headless ViewWeaver host — generate-for-ai without Creator / MCP.
 *
 * Uses the project's own extension CLI so layout stays put:
 *   extensions/viewweaver  → assets/scripts/views/
 *   extensions/genbot      → assets/scripts/_genbot/
 *
 * Never falls back to a foreign ViewWeaver copy (that would migrate _genbot → views
 * and break existing imports).
 *
 *   node viewweaver-host.mjs --project <dir> CTA
 *   node viewweaver-host.mjs --project <dir> assets/resources/prefab/CTA.prefab
 *   node viewweaver-host.mjs --project <dir> --all
 *   node viewweaver-host.mjs --project <dir> --status
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REGISTRY_RELS = [
  'assets/scripts/views/__registry.json',
  'assets/scripts/_genbot/__registry.json',
];

const CLI_CANDIDATES = [
  ['extensions/viewweaver/src/cli.ts', 'viewweaver'],
  ['extensions/viewweaver/dist/cli.js', 'viewweaver'],
  ['extensions/genbot/src/cli.ts', 'genbot'],
  ['extensions/genbot/dist/cli.js', 'genbot'],
];

export function loadRegistry(projectRoot) {
  for (const rel of REGISTRY_RELS) {
    const file = path.join(projectRoot, rel);
    if (!fs.existsSync(file)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { file, rel, tool: data.tool || 'genbot', entries: data.entries || {} };
    } catch {
      return { file, rel, tool: 'unknown', entries: {}, error: 'invalid json' };
    }
  }
  return { file: null, rel: null, tool: null, entries: {} };
}

export function resolveCli(projectRoot) {
  const env = process.env.VIEWWEAVER_CLI;
  if (env && fs.existsSync(env)) {
    return { file: path.resolve(env), tool: guessTool(env), via: 'VIEWWEAVER_CLI' };
  }
  for (const [rel, tool] of CLI_CANDIDATES) {
    const file = path.join(projectRoot, rel);
    if (fs.existsSync(file)) return { file, tool, via: rel };
  }
  return null;
}

function guessTool(file) {
  const n = file.replace(/\\/g, '/').toLowerCase();
  if (n.includes('viewweaver')) return 'viewweaver';
  if (n.includes('genbot')) return 'genbot';
  return 'viewweaver';
}

export function resolvePrefabAbs(projectRoot, target) {
  if (!target) return null;
  const raw = String(target).trim();
  if (!raw) return null;

  if (path.isAbsolute(raw) && raw.toLowerCase().endsWith('.prefab') && fs.existsSync(raw)) {
    return raw;
  }

  const asRel = path.join(projectRoot, raw.replace(/^db:\/\//, ''));
  if (asRel.toLowerCase().endsWith('.prefab') && fs.existsSync(asRel)) return asRel;

  const registry = loadRegistry(projectRoot);
  const byName = registry.entries[raw];
  if (byName?.prefabPath) {
    const abs = path.join(projectRoot, byName.prefabPath);
    if (fs.existsSync(abs)) return abs;
  }

  for (const e of Object.values(registry.entries)) {
    if (!e?.prefabPath) continue;
    const abs = path.join(projectRoot, e.prefabPath);
    if (!fs.existsSync(abs)) continue;
    if (e.prefabName === raw || e.prefabPath.replace(/\\/g, '/') === raw.replace(/\\/g, '/')) {
      return abs;
    }
    const metaPath = `${abs}.meta`;
    try {
      const uuid = JSON.parse(fs.readFileSync(metaPath, 'utf8')).uuid;
      if (uuid === raw) return abs;
    } catch {}
  }
  return null;
}

export function matchRegistryAsset(projectRoot, assetRel) {
  const rel = String(assetRel || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!rel) return null;
  const registry = loadRegistry(projectRoot);
  for (const e of Object.values(registry.entries)) {
    const prefab = String(e.prefabPath || '').replace(/\\/g, '/');
    const bind = String(e.bindJsonPath || '').replace(/\\/g, '/');
    if (rel === prefab || rel === `${prefab}.meta`) return e;
    if (rel === bind || rel === `${bind}.meta`) return e;
  }
  return null;
}

function nodeArgsForCli(cliFile) {
  if (cliFile.endsWith('.ts')) return ['--experimental-strip-types', cliFile];
  return [cliFile];
}

export function generatePrefab(projectRoot, target, opts = {}) {
  const cli = resolveCli(projectRoot);
  if (!cli) {
    return Promise.resolve({
      ok: false,
      error: 'no ViewWeaver/genbot CLI in this project (extensions/viewweaver or extensions/genbot)',
    });
  }
  const prefabAbs = resolvePrefabAbs(projectRoot, target);
  if (!prefabAbs) {
    return Promise.resolve({ ok: false, error: `prefab not found: ${target}` });
  }

  const args = [
    ...nodeArgsForCli(cli.file),
    prefabAbs,
    '--project',
    projectRoot,
    '--quiet',
  ];
  if (opts.regenBind) args.push('--regen-bind');
  if (opts.dryRun) args.push('--dry-run');

  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: path.dirname(cli.file),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    const chunks = [];
    child.stdout.on('data', (b) => chunks.push(b));
    child.stderr.on('data', (b) => chunks.push(b));
    child.on('close', (code) => {
      const log = Buffer.concat(chunks).toString('utf8').trim();
      resolve({
        ok: code === 0,
        tool: cli.tool,
        cli: cli.via,
        prefab: path.relative(projectRoot, prefabAbs).replace(/\\/g, '/'),
        code,
        log: log.slice(-2000),
      });
    });
    child.on('error', (err) => {
      resolve({ ok: false, error: String(err.message || err) });
    });
  });
}

export async function generateAll(projectRoot, opts = {}) {
  const registry = loadRegistry(projectRoot);
  const names = Object.keys(registry.entries);
  const results = [];
  for (const name of names) {
    results.push(await generatePrefab(projectRoot, name, opts));
  }
  return {
    ok: results.every((r) => r.ok),
    count: results.length,
    results,
  };
}

export function status(projectRoot) {
  const cli = resolveCli(projectRoot);
  const registry = loadRegistry(projectRoot);
  return {
    available: !!cli,
    tool: cli?.tool || null,
    cli: cli?.via || null,
    registry: registry.rel,
    prefabs: Object.keys(registry.entries),
  };
}

function printHelp() {
  process.stdout.write(
    [
      'headless ViewWeaver — generate-for-ai without Creator',
      '',
      'Usage:',
      '  node viewweaver-host.mjs --project <dir> <prefab-name-or-path>',
      '  node viewweaver-host.mjs --project <dir> --all',
      '  node viewweaver-host.mjs --project <dir> --status',
      '',
    ].join('\n'),
  );
}

async function main() {
  const argv = process.argv.slice(2);
  let project = process.env.PROJECT || process.cwd();
  let all = false;
  let showStatus = false;
  let dryRun = false;
  let regenBind = false;
  let target = '';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') project = argv[++i];
    else if (a === '--all') all = true;
    else if (a === '--status') showStatus = true;
    else if (a === '--dry-run') dryRun = true;
    else if (a === '--regen-bind') regenBind = true;
    else if (a === '-h' || a === '--help') {
      printHelp();
      process.exit(0);
    } else if (!a.startsWith('-')) target = a;
  }
  project = path.resolve(project);
  if (showStatus) {
    process.stdout.write(`${JSON.stringify(status(project), null, 2)}\n`);
    return;
  }
  const result = all
    ? await generateAll(project, { dryRun, regenBind })
    : await generatePrefab(project, target, { dryRun, regenBind });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
