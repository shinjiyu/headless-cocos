'use strict';

/**
 * Version-pinned headless runtime (engine + mini-packer), not a Creator install.
 *
 * Layout:
 *   runtime/3.8.8/
 *     manifest.json
 *     engine/           preview + native-external + internal-library
 *     node_modules/     traced @cocos/creator-programming-*
 *     utils/dist/uuid.js
 */

const fs = require('fs');
const path = require('path');

const ENGINE_VERSION = '3.8.8';

function repoRootFrom(here) {
  return path.resolve(here, '..');
}

function kitDir(repoRoot) {
  return path.join(repoRoot, 'runtime', ENGINE_VERSION);
}

function engineLooksReady(dir) {
  return Boolean(dir && fs.existsSync(path.join(dir, 'preview')));
}

function npmLooksReady(dir) {
  return Boolean(
    dir &&
      fs.existsSync(path.join(dir, '@cocos/creator-programming-quick-pack/lib/quick-pack.js')),
  );
}

function resolveEngineSnapshot(opts = {}) {
  const env = opts.env || process.env;
  const repoRoot = opts.repoRoot || repoRootFrom(__dirname);
  if (env.ENGINE_SNAPSHOT && engineLooksReady(env.ENGINE_SNAPSHOT)) {
    return path.resolve(env.ENGINE_SNAPSHOT);
  }
  const candidates = [
    path.join(kitDir(repoRoot), 'engine'),
    path.join(repoRoot, 'templates/runtime/engine-snapshot'),
    path.join(repoRoot, 'docker/build-context/engine'),
    path.join(repoRoot, 'spike/engine-snapshot'),
  ];
  for (const dir of candidates) {
    if (engineLooksReady(dir)) return path.resolve(dir);
  }
  return '';
}

function resolveNpmRoot(opts = {}) {
  const env = opts.env || process.env;
  const repoRoot = opts.repoRoot || repoRootFrom(__dirname);
  if (env.NPM_ROOT && npmLooksReady(env.NPM_ROOT)) {
    return path.resolve(env.NPM_ROOT);
  }
  const candidates = [
    path.join(kitDir(repoRoot), 'node_modules'),
    path.join(repoRoot, 'docker/build-context/vendor/node_modules'),
    path.join(repoRoot, 'tmp-asar-root/node_modules'),
    path.join(repoRoot, 'node_modules'),
  ];
  for (const dir of candidates) {
    if (npmLooksReady(dir)) return path.resolve(dir);
  }
  return '';
}

function resolveUuidUtil(opts = {}) {
  const env = opts.env || process.env;
  const repoRoot = opts.repoRoot || repoRootFrom(__dirname);
  const npm = resolveNpmRoot({ env, repoRoot });
  if (env.UUID_UTIL && fs.existsSync(env.UUID_UTIL)) return path.resolve(env.UUID_UTIL);
  const candidates = [
    path.join(kitDir(repoRoot), 'utils/dist/uuid.js'),
    path.join(repoRoot, 'docker/build-context/vendor/utils/dist/uuid.js'),
    npm ? path.join(npm, '../utils/dist/uuid.js') : '',
  ].filter(Boolean);
  for (const file of candidates) {
    if (fs.existsSync(file)) return path.resolve(file);
  }
  return '';
}

function kitStatus(opts = {}) {
  const repoRoot = opts.repoRoot || repoRootFrom(__dirname);
  const env = opts.env || process.env;
  const engine = resolveEngineSnapshot({ env, repoRoot });
  const npm = resolveNpmRoot({ env, repoRoot });
  const uuid = resolveUuidUtil({ env, repoRoot });
  return {
    version: ENGINE_VERSION,
    kit: kitDir(repoRoot),
    engine,
    npm,
    uuid,
    ready: Boolean(engine && npm && uuid),
  };
}

function kitDoNotNpmHelp() {
  return [
    '[runtime-kit] 不要在 runtime/ 里跑 npm install / npm ci / npm prune。',
    '@cocos/creator-programming-* 是预置的，不在 dependencies 里；一装包就会被删掉，packer 全坏。',
    '缺 @babel/helpers 或 @cocos/* = 这份 runtime 坏了。停预览，用干净的 runtime/3.8.8 整目录覆盖（重新 clone 或 node spike/fetch-runtime.mjs）。',
    '不要从 Creator 安装目录抠包。不要为补模块去 npm install。',
  ].join('\n');
}

function kitMissingHelp(repoRoot) {
  const root = repoRoot || repoRootFrom(__dirname);
  return [
    `[runtime-kit] missing ${path.join(root, 'runtime', ENGINE_VERSION)}/.`,
    'This directory ships in the repo. Re-clone feat/artist-preview-design.',
    'Do not install Cocos Creator. Do not extract app.asar.',
    kitDoNotNpmHelp(),
  ].join('\n');
}

function plantNpmGuard(kitRoot) {
  if (!kitRoot) return;
  fs.mkdirSync(kitRoot, { recursive: true });
  fs.writeFileSync(
    path.join(kitRoot, 'block-npm-install.cjs'),
    [
      "'use strict';",
      "console.error('[runtime-kit] STOP: do not npm install in runtime/.');",
      "console.error('Restore the whole runtime/3.8.8 kit. Do not install @babel/* or @cocos/*.');",
      'process.exit(1);',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(kitRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: `headless-cocos-runtime-${ENGINE_VERSION}`,
        private: true,
        description:
          'Pinned Cocos packer tree. Do not npm install here. Do not relax engines to make npm work.',
        engines: { node: '<0.0.0' },
        scripts: { preinstall: 'node block-npm-install.cjs' },
      },
      null,
      2,
    )}\n`,
  );
  fs.writeFileSync(
    path.join(kitRoot, '.npmrc'),
    ['engine-strict=true', 'ignore-scripts=false', ''].join('\n'),
  );
}

module.exports = {
  ENGINE_VERSION,
  kitDir,
  kitStatus,
  kitMissingHelp,
  kitDoNotNpmHelp,
  plantNpmGuard,
  engineLooksReady,
  npmLooksReady,
  resolveEngineSnapshot,
  resolveNpmRoot,
  resolveUuidUtil,
};
