#!/usr/bin/env node
'use strict';

/**
 * Audio importer loop:
 *   1. synthesize a 0.5s WAV into assets/audio/beep.wav (no .meta)
 *   2. container importer generates .meta + library AudioClip JSON + bytes
 *   3. browser loadAny({uuid}) resolves a cc.AudioClip with a real duration
 * `--cleanup` removes the test files.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PROJECT = 'd:/tempWorkspace/baseAIAutoCocos';
const ASSETS = path.join(PROJECT, 'assets');
const AUDIO_DIR = path.join(ASSETS, 'audio');
const WAV = path.join(AUDIO_DIR, 'beep.wav');
const URL = 'http://127.0.0.1:7460/?autoReload=false';

const SAMPLE_RATE = 8000;
const SECONDS = 0.5;

function makeWav() {
  const samples = Math.round(SAMPLE_RATE * SECONDS);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    data.writeInt16LE(Math.round(Math.sin((i / SAMPLE_RATE) * 2 * Math.PI * 440) * 12000), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);       // fmt chunk size
  header.writeUInt16LE(1, 20);        // PCM
  header.writeUInt16LE(1, 22);        // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  header.writeUInt16LE(2, 32);        // block align
  header.writeUInt16LE(16, 34);       // bits per sample
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
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

if (process.argv.includes('--cleanup')) {
  for (const f of [WAV, WAV + '.meta']) {
    try { fs.unlinkSync(f); console.log('[e2e-audio] removed', path.relative(PROJECT, f)); } catch {}
  }
  try { fs.rmdirSync(AUDIO_DIR); } catch {}
  process.exit(0);
}

(async () => {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  fs.writeFileSync(WAV, makeWav());
  console.log('[e2e-audio] wrote', path.relative(PROJECT, WAV));

  const meta = await waitFor('beep.wav.meta from container importer', () => {
    try { return JSON.parse(fs.readFileSync(WAV + '.meta', 'utf8')); } catch { return null; }
  });
  console.log('[e2e-audio] imported, uuid =', meta.uuid);
  await waitFor('library AudioClip json', () => {
    const dir = path.join(PROJECT, 'library', meta.uuid.slice(0, 2));
    return fs.existsSync(path.join(dir, `${meta.uuid}.json`)) && fs.existsSync(path.join(dir, `${meta.uuid}.wav`));
  });

  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction(
    () => !!(globalThis.cc && globalThis.__HEADLESS_PROBE__),
    { timeout: 90000 },
  );

  const result = await page.evaluate((uuid) => new Promise((resolve) => {
    globalThis.cc.assetManager.loadAny({ uuid }, (err, clip) => {
      if (err) {
        resolve({ ok: false, error: String(err.message || err) });
        return;
      }
      resolve({
        ok: true,
        type: clip?.constructor?.name,
        name: clip?.name,
        duration: clip?.getDuration?.(),
        loadMode: clip?.loadMode,
        native: clip?._native,
        nativeUrl: clip?.nativeUrl,
      });
    });
  }), meta.uuid);
  await browser.close();

  console.log('[e2e-audio] result:', JSON.stringify(result));
  if (errors.length) console.log('[e2e-audio] console errors:', errors.slice(0, 5));
  if (result.ok && result.type === 'AudioClip' && Math.abs(result.duration - SECONDS) < 0.05) {
    console.log('[e2e-audio] SUCCESS — WAV → auto import → browser AudioClip, duration ≈', result.duration);
  } else {
    console.log('[e2e-audio] FAIL');
    process.exit(1);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
