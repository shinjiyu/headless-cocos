#!/usr/bin/env node
/**
 * Pack the headless flavor of baseAIAutoCocos:
 *   ViewWeaver + Creator 3.8.8 settings + boot scene
 *   no cocos-meta-mcp, no Creator MCP skills
 *
 *   node spike/pack-base-ai-headless.mjs
 *   node spike/pack-base-ai-headless.mjs --from D:\tempWorkspace\baseAIAutoCocos
 */

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const DEST = path.join(REPO, 'templates/base-ai-headless');

const SKIP_PREFIX = [
  'extensions/cocos-meta-mcp/',
  '.cursor/skills/cocos-meta-mcp-',
  '.cursor/skills/creator-preview-refresh/',
  '.cursor/skills/creator-console-log/',
  '.cursor/skills/creator-scene-editing/',
  '.cursor/skills/cocos-replacement-reskin/',
  '.cursor/rules/git-use-hutao.mdc',
];

const SKIP_EXACT = new Set([
  'extensions/cocos-meta-mcp',
  '.cursor/skills/README.md',
]);

function parseArgs(argv) {
  const out = { from: '', dest: DEST, exportDir: '', force: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from') out.from = argv[++i];
    else if (a === '--out') out.dest = path.resolve(argv[++i]);
    else if (a === '--export') out.exportDir = path.resolve(argv[++i]);
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function defaultFrom() {
  const sibling = path.resolve(REPO, '../baseAIAutoCocos');
  if (fs.existsSync(path.join(sibling, 'package.json'))) return sibling;
  return '';
}

function gitBin() {
  const candidates = [
    process.env.HUTAO,
    'D:/Tools/Hutao/cmd/git.exe',
    'D:/tools/Hutao/cmd/git.exe',
    'D:/Tools/Hutao/cmd/hutao.cmd',
    'D:/tools/Hutao/cmd/hutao.cmd',
  ].filter(Boolean);
  for (const bin of candidates) {
    if (fs.existsSync(bin)) return bin;
  }
  return process.platform === 'win32' ? 'hutao' : 'git';
}

function trackedFiles(root) {
  const out = execFileSync(gitBin(), ['ls-tree', '-r', '--name-only', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  });
  return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function skipTracked(rel) {
  const n = rel.replace(/\\/g, '/');
  if (SKIP_EXACT.has(n)) return true;
  return SKIP_PREFIX.some((p) => n === p.replace(/\/$/, '') || n.startsWith(p));
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function writeJson(dest, data) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, `${JSON.stringify(data, null, 2)}\n`);
}

function writeText(dest, text) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, text.endsWith('\n') ? text : `${text}\n`);
}

function folderMeta(uuid, userData = {}) {
  return {
    ver: '1.2.0',
    importer: 'directory',
    imported: true,
    uuid,
    files: [],
    subMetas: {},
    userData,
  };
}

function remapIds(value, map) {
  if (Array.isArray(value)) {
    return value.map((v) => remapIds(v, map)).filter((v) => v !== undefined);
  }
  if (value && typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, '__id__') && Object.keys(value).length === 1) {
      if (!map.has(value.__id__)) return undefined;
      return { __id__: map.get(value.__id__) };
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const next = remapIds(v, map);
      if (next !== undefined) out[k] = next;
    }
    return out;
  }
  return value;
}

function stripPreviewBoot(scene) {
  const dropType = new Set(['6bfb5n25yxKvrVUsXF25j4d']);
  const dropName = new Set(['HeroSprite', 'HeadlessProbe']);
  const drop = new Set();
  scene.forEach((obj, i) => {
    if (dropType.has(obj.__type__) || dropName.has(obj._name)) drop.add(i);
  });
  scene.forEach((obj, i) => {
    if (obj && obj.node && typeof obj.node.__id__ === 'number' && drop.has(obj.node.__id__)) {
      drop.add(i);
    }
  });
  const map = new Map();
  let n = 0;
  scene.forEach((_, i) => {
    if (!drop.has(i)) map.set(i, n++);
  });
  return scene.filter((_, i) => !drop.has(i)).map((obj) => remapIds(obj, map));
}

function writeBootAssets(dest, fromRoot) {
  const assets = path.join(dest, 'assets');
  const sceneSrc = path.join(fromRoot, 'assets/scene/PreviewBoot.scene');
  const sceneMetaSrc = path.join(fromRoot, 'assets/scene/PreviewBoot.scene.meta');
  const sceneDest = path.join(assets, 'scene/PreviewBoot.scene');

  if (!fs.existsSync(sceneSrc)) {
    throw new Error(`missing boot scene at ${sceneSrc} (local checkout needs PreviewBoot)`);
  }
  const raw = JSON.parse(fs.readFileSync(sceneSrc, 'utf8'));
  const cleaned = stripPreviewBoot(raw);
  writeJson(sceneDest, cleaned);

  if (fs.existsSync(sceneMetaSrc)) {
    copyFile(sceneMetaSrc, `${sceneDest}.meta`);
  } else {
    writeJson(`${sceneDest}.meta`, {
      ver: '1.1.50',
      importer: 'scene',
      imported: true,
      uuid: '23ed0669-5d4b-4089-9483-04ac7220ee5a',
      files: ['.json'],
      subMetas: {},
      userData: {},
    });
  }

  const sceneFolderMeta = path.join(fromRoot, 'assets/scene.meta');
  copyOrMintFolder(sceneFolderMeta, path.join(assets, 'scene.meta'), 'b5f59a27-1f64-42fe-890a-21490c2e2afa');

  const scriptsMeta = path.join(fromRoot, 'assets/scripts.meta');
  copyOrMintFolder(scriptsMeta, path.join(assets, 'scripts.meta'), '9e546be4-fe00-49be-ac13-cc7eccdb5459');

  writeText(path.join(assets, 'scripts/views/.gitkeep'), '');
  writeJson(path.join(assets, 'scripts/views.meta'), folderMeta(crypto.randomUUID()));

  writeText(path.join(assets, 'prefabs/.gitkeep'), '');
  writeJson(path.join(assets, 'prefabs.meta'), folderMeta(crypto.randomUUID()));

  writeText(path.join(assets, 'resources/.gitkeep'), '');
  writeJson(
    path.join(assets, 'resources.meta'),
    folderMeta(crypto.randomUUID(), {
      isBundle: true,
      bundleConfigID: 'default',
      bundleName: 'resources',
      priority: 8,
    }),
  );
}

function copyOrMintFolder(src, dest, fallbackUuid) {
  if (fs.existsSync(src)) {
    copyFile(src, dest);
    return;
  }
  writeJson(dest, folderMeta(fallbackUuid));
}

function writeOverlayDocs(dest) {
  writeText(
    path.join(dest, 'README.md'),
    `# baseAIAutoCocos (headless)

Cocos Creator **3.8.8** AI tooling base for **headless-cocos**.

Same lineage as [baseAIAutoCocos](https://github.com/shinjiyu/baseAIAutoCocos):
ViewWeaver + engine settings + a bootable 2D scene. **No MCP.**

| Keep | Drop |
|------|------|
| \`extensions/viewweaver\` | \`extensions/cocos-meta-mcp\` |
| \`settings/\` + \`PreviewBoot.scene\` | Creator MCP / preview-refresh skills |
| \`assets/scripts/views/\` (ViewWeaver out) | Board / MainUI / CTA / symbol-library |

## Use

\`\`\`powershell
node spike/create-project.mjs --template base-ai --out D:\\tempWorkspace\\my-game
$env:PROJECT="D:\\tempWorkspace\\my-game"
node spike/preview-mirror.mjs
\`\`\`

ViewWeaver: \`POST /__viewweaver\` or \`node spike/viewweaver-host.mjs --project <dir> <Prefab>\`.

Do not call \`cocosmcp\` / Creator \`Editor.Message\`.

Refresh this folder from a local baseAIAutoCocos checkout:

\`\`\`powershell
node spike/pack-base-ai-headless.mjs --from D:\\tempWorkspace\\baseAIAutoCocos
\`\`\`
`,
  );

  writeText(
    path.join(dest, 'AGENTS.md'),
    `# Headless Cocos project — no Creator IDE, no MCP

Preview is a **headless** service (\`preview-mirror\` + mini-packer + ViewWeaver host).

## How preview updates

1. Edit files under \`assets/\`.
2. The preview process watches the disk.
3. Missing \`.meta\` files are minted; scripts are packed; prefabs can run ViewWeaver.
4. The browser receives HMR.

## ViewWeaver

- Output: \`assets/scripts/views/<Name>/\`
- HTTP: \`GET/POST /__viewweaver\`
- CLI: \`node spike/viewweaver-host.mjs --project <this-dir> <PrefabName>\`
- Do **not** pass \`--regen-bind\` unless you intend to rewrite the contract.

## Do not

- Call \`cocosmcp\` / Creator \`Editor.Message\` / any MCP bridge.
- Start Cocos Creator or refresh an IDE preview.
- Copy playable-ad Board / MainUI / CTA stubs into this shell unless the project is a PA.
`,
  );

  writeText(
    path.join(dest, '.cursor/skills/README.md'),
    `# Project Agent Skills

Headless flavor of baseAIAutoCocos: **ViewWeaver only, no MCP.**

Creator MCP skills (\`cocos-meta-mcp-*\`, \`creator-preview-refresh\`,
\`creator-scene-editing\`) are intentionally absent.

Use the preview HTTP surface:

- disk watch → HMR
- \`POST /__viewweaver\` for Prefab → \`assets/scripts/views/\`
`,
  );

  const pkgPath = path.join(dest, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.name = 'baseAIAutoCocos-headless';
  writeJson(pkgPath, pkg);
}

function emptyDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function exportLibrary(src, dest) {
  emptyDir(dest);
  const skip = new Set(['.git', 'library', 'temp', 'node_modules']);
  const walk = (from, to) => {
    const st = fs.statSync(from);
    if (st.isDirectory()) {
      if (skip.has(path.basename(from))) return;
      fs.mkdirSync(to, { recursive: true });
      for (const name of fs.readdirSync(from)) walk(path.join(from, name), path.join(to, name));
      return;
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  };
  walk(src, dest);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      'Pack baseAIAutoCocos → templates/base-ai-headless (ViewWeaver, no MCP).\n\n' +
        '  node spike/pack-base-ai-headless.mjs [--from <baseAIAutoCocos>]\n' +
        '  node spike/pack-base-ai-headless.mjs --export D:\\tempWorkspace\\baseAIAutoCocos-headless\n',
    );
    return;
  }

  const dest = path.resolve(args.dest);
  const alreadyPacked =
    fs.existsSync(path.join(dest, 'assets/scene/PreviewBoot.scene')) &&
    fs.existsSync(path.join(dest, 'extensions/viewweaver/src/cli.ts'));

  if (args.exportDir && alreadyPacked && !args.from) {
    exportLibrary(dest, args.exportDir);
    process.stdout.write(`${JSON.stringify({ ok: true, export: args.exportDir, from: dest }, null, 2)}\n`);
    return;
  }

  const from = path.resolve(args.from || defaultFrom());
  if (!from || !fs.existsSync(path.join(from, 'package.json'))) {
    throw new Error('need --from <baseAIAutoCocos checkout>');
  }
  emptyDir(dest);

  const files = trackedFiles(from);
  let copied = 0;
  let skipped = 0;
  for (const rel of files) {
    if (skipTracked(rel)) {
      skipped += 1;
      continue;
    }
    const src = path.join(from, rel);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) {
      skipped += 1;
      continue;
    }
    copyFile(src, path.join(dest, rel));
    copied += 1;
  }

  writeBootAssets(dest, from);
  writeOverlayDocs(dest);

  const mcpLeft = fs.existsSync(path.join(dest, 'extensions/cocos-meta-mcp'));
  const vw = fs.existsSync(path.join(dest, 'extensions/viewweaver/src/cli.ts'));
  const scene = fs.existsSync(path.join(dest, 'assets/scene/PreviewBoot.scene'));
  if (mcpLeft) throw new Error('MCP extension still present after pack');
  if (!vw) throw new Error('ViewWeaver CLI missing after pack');
  if (!scene) throw new Error('PreviewBoot.scene missing after pack');

  if (args.exportDir) exportLibrary(dest, args.exportDir);

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      from,
      out: dest,
      export: args.exportDir || undefined,
      copied,
      skippedTracked: skipped,
      viewweaver: true,
      mcp: false,
    }, null, 2)}\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    process.stderr.write(`[pack-base-ai-headless] ${e.message || e}\n`);
    process.exit(1);
  }
}

export { DEST, skipTracked, stripPreviewBoot };
