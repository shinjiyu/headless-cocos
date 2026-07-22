#!/usr/bin/env node
'use strict';

/**
 * Animation + text assets without the IDE:
 *   1. write assets/animtest/move.anim   — VectorTrack on `position`, x: 0→200 over 1s
 *   2. write assets/animtest/notes.txt   — plain text (i18n/config style)
 *   3. write assets/animtest/ctrl.animgraph — minimal cc.animation.AnimationGraph
 *   4. mirror syncs/imports all three into library/
 *   5. browser: loadAny(anim) → cc.Animation.play() → node actually moves;
 *      loadAny(txt) → cc.TextAsset.text matches;
 *      loadAny(animgraph) → cc.animation.AnimationGraph instance
 * `--cleanup` removes the test files.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PROJECT = 'd:/tempWorkspace/baseAIAutoCocos';
const ASSETS = path.join(PROJECT, 'assets');
const DIR = path.join(ASSETS, 'animtest');
const URL = 'http://127.0.0.1:7460/?autoReload=false';
const TEXT_BODY = 'headless text asset OK\nline2,csv,style';

function realKey(value) {
  return {
    __type__: 'cc.RealKeyframeValue',
    interpolationMode: 0, // LINEAR
    tangentWeightMode: 0,
    value,
    rightTangent: 0,
    rightTangentWeight: 1,
    leftTangent: 0,
    leftTangentWeight: 1,
    easingMethod: 0,
    __editorExtras__: { broken: null },
  };
}

function realCurve(times, values) {
  return {
    __type__: 'cc.RealCurve',
    _times: times,
    _values: values.map(realKey),
    preExtrapolation: 1,
    postExtrapolation: 1,
  };
}

// AnimationClip "move": node position.x 0 → 200 over 1s, looping
function animJson() {
  return [
    {
      __type__: 'cc.AnimationClip',
      _name: 'move',
      _objFlags: 0,
      __editorExtras__: { embeddedPlayerGroups: [] },
      _native: '',
      sample: 60,
      speed: 1,
      wrapMode: 2, // Loop
      enableTrsBlending: false,
      _duration: 1,
      _hash: 0,
      _tracks: [{ __id__: 1 }],
      _exoticAnimation: null,
      _events: [],
      _embeddedPlayers: [],
      _additiveSettings: { __id__: 11 },
      _auxiliaryCurveEntries: [],
    },
    {
      __type__: 'cc.animation.VectorTrack',
      _binding: {
        __type__: 'cc.animation.TrackBinding',
        path: { __id__: 2 },
        proxy: null,
      },
      _channels: [{ __id__: 3 }, { __id__: 5 }, { __id__: 7 }, { __id__: 9 }],
      _nComponents: 3,
    },
    { __type__: 'cc.animation.TrackPath', _paths: ['position'] },
    { __type__: 'cc.animation.Channel', _curve: { __id__: 4 } },
    realCurve([0, 1], [0, 200]),
    { __type__: 'cc.animation.Channel', _curve: { __id__: 6 } },
    realCurve([0], [0]),
    { __type__: 'cc.animation.Channel', _curve: { __id__: 8 } },
    realCurve([0], [0]),
    { __type__: 'cc.animation.Channel', _curve: { __id__: 10 } },
    realCurve([], []),
    { __type__: 'cc.AnimationClipAdditiveSettings', enabled: false, refClip: null },
  ];
}

// Minimal AnimationGraph: one empty layer, no variables
function animGraphJson() {
  return [
    {
      __type__: 'cc.animation.AnimationGraph',
      _name: '',
      _objFlags: 0,
      __editorExtras__: {},
      _native: '',
      _layers: [{ __id__: 1 }],
      _variables: {},
    },
    {
      __type__: 'cc.animation.Layer',
      _stateMachine: { __id__: 2 },
      name: '',
      weight: 1,
      mask: null,
      additive: false,
      _stashes: {},
    },
    {
      __type__: 'cc.animation.StateMachine',
      __editorExtras__: { name: '', id: 'headless-sm', clone: null },
      _states: [{ __id__: 3 }, { __id__: 4 }, { __id__: 5 }],
      _transitions: [],
      _entryState: { __id__: 3 },
      _exitState: { __id__: 4 },
      _anyState: { __id__: 5 },
    },
    { __type__: 'cc.animation.State', __editorExtras__: { name: '', id: 'e', clone: null }, name: 'Entry' },
    { __type__: 'cc.animation.State', __editorExtras__: { name: '', id: 'x', clone: null }, name: 'Exit' },
    { __type__: 'cc.animation.State', __editorExtras__: { name: '', id: 'a', clone: null }, name: 'Any' },
  ];
}

function writeMeta(assetFile, uuid, importer) {
  fs.writeFileSync(assetFile + '.meta', JSON.stringify({
    ver: '1.0.0',
    importer,
    imported: true,
    uuid,
    files: ['.json'],
    subMetas: {},
    userData: {},
  }, null, 2));
}

async function waitFor(desc, fn, timeoutMs = 20000, stepMs = 500) {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${desc}`);
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

function cleanup() {
  try { fs.rmSync(DIR, { recursive: true, force: true }); console.log('[e2e-anim-text] removed', path.relative(PROJECT, DIR)); } catch {}
}

if (process.argv.includes('--cleanup')) {
  cleanup();
  process.exit(0);
}

(async () => {
  cleanup();
  const animUuid = crypto.randomUUID();
  const textUuid = crypto.randomUUID();
  const graphUuid = crypto.randomUUID();
  fs.mkdirSync(DIR, { recursive: true });

  const animFile = path.join(DIR, 'move.anim');
  fs.writeFileSync(animFile, JSON.stringify(animJson(), null, 2));
  writeMeta(animFile, animUuid, 'animation-clip');

  const textFile = path.join(DIR, 'notes.txt');
  fs.writeFileSync(textFile, TEXT_BODY);
  writeMeta(textFile, textUuid, 'text');

  const graphFile = path.join(DIR, 'ctrl.animgraph');
  fs.writeFileSync(graphFile, JSON.stringify(animGraphJson(), null, 2));
  writeMeta(graphFile, graphUuid, 'animation-graph');

  console.log('[e2e-anim-text] wrote anim =', animUuid, 'text =', textUuid, 'graph =', graphUuid);

  const lib = (u) => path.join(PROJECT, 'library', u.slice(0, 2), `${u}.json`);
  await waitFor('library products for anim/text/animgraph', () =>
    fs.existsSync(lib(animUuid)) && fs.existsSync(lib(textUuid)) && fs.existsSync(lib(graphUuid)));

  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction(
    () => !!(globalThis.cc && globalThis.__HEADLESS_PROBE__ && globalThis.cc.director?.getScene?.()),
    { timeout: 90000 },
  );

  const result = await page.evaluate((uuids, expectedText) => new Promise((resolve) => {
    const cc = globalThis.cc;
    const out = {};
    const loadOne = (uuid) => new Promise((res) =>
      cc.assetManager.loadAny({ uuid }, (err, asset) => res(err ? { err: String(err.message || err) } : { asset })));

    (async () => {
      // 1. TextAsset
      const t = await loadOne(uuids.text);
      out.text = t.err ? { ok: false, error: t.err } : {
        ok: t.asset instanceof cc.TextAsset && t.asset.text === expectedText,
        type: t.asset?.constructor?.name,
        len: t.asset?.text?.length,
      };

      // 2. AnimationGraph
      const g = await loadOne(uuids.graph);
      out.graph = g.err ? { ok: false, error: g.err } : {
        ok: g.asset?.constructor?.name === 'AnimationGraph' && g.asset.layers?.length === 1,
        type: g.asset?.constructor?.name,
        layers: g.asset?.layers?.length,
      };

      // 3. AnimationClip: play on a node, verify position actually animates
      const a = await loadOne(uuids.anim);
      if (a.err) {
        out.anim = { ok: false, error: a.err };
      } else {
        const clip = a.asset;
        const node = new cc.Node('AnimTarget');
        cc.director.getScene().getChildByName('Canvas').addChild(node);
        node.setPosition(0, 0, 0);
        const comp = node.addComponent(cc.Animation);
        comp.defaultClip = clip;
        comp.play();
        const x0 = node.position.x;
        await new Promise((r) => setTimeout(r, 500));
        const x1 = node.position.x;
        out.anim = {
          ok: clip instanceof cc.AnimationClip && x1 > x0 + 10,
          type: clip?.constructor?.name,
          duration: clip?.duration,
          x0, x1,
          playing: comp.getState('move')?.isPlaying ?? null,
        };
      }
      resolve(out);
    })();
  }), { anim: animUuid, text: textUuid, graph: graphUuid }, TEXT_BODY);
  await browser.close();

  console.log('[e2e-anim-text] result:', JSON.stringify(result, null, 2));
  if (errors.length) console.log('[e2e-anim-text] console errors:', errors.slice(0, 5));
  cleanup();
  if (result.text?.ok && result.graph?.ok && result.anim?.ok) {
    console.log('[e2e-anim-text] SUCCESS — .anim plays, .txt loads, .animgraph deserializes');
  } else {
    console.log('[e2e-anim-text] FAIL');
    process.exit(1);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
