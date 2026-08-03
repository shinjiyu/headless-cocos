/**
 * M1.5 smoke: upload mini.psd -> wait edit_ready -> layers + scene-edit
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.SMOKE_HOST || '127.0.0.1';
const PORT = Number(process.env.SMOKE_PORT || 8800);
const FIXTURE = path.join(__dirname, '../fixtures/mini.psd');

function req(method, urlPath, headers = {}, bodyBuf) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { hostname: HOST, port: PORT, path: urlPath, method, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    r.on('error', reject);
    if (bodyBuf) r.write(bodyBuf);
    r.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const buf = fs.readFileSync(FIXTURE);
const boundary = `----m15smoke${Date.now()}`;
const body = Buffer.concat([
  Buffer.from(
    `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="file"; filename="mini.psd"\r\n' +
      'Content-Type: image/vnd.adobe.photoshop\r\n\r\n',
  ),
  buf,
  Buffer.from(`\r\n--${boundary}--\r\n`),
]);

const health = await req('GET', '/api/health');
console.log('health', health.status, health.body.toString());
if (health.status !== 200) process.exit(1);

const up = await req(
  'POST',
  '/api/jobs',
  {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': body.length,
  },
  body,
);
console.log('upload', up.status, up.body.toString());
if (up.status !== 201) process.exit(1);
const job = JSON.parse(up.body.toString());

let meta = job;
for (let i = 0; i < 60; i++) {
  await sleep(500);
  const g = await req('GET', `/api/jobs/${job.id}`);
  meta = JSON.parse(g.body.toString());
  console.log('poll', meta.status, meta.stage, meta.tileCount ?? '');
  if (meta.status === 'edit_ready' || meta.status === 'failed') break;
}
if (meta.status !== 'edit_ready') {
  console.error('parse failed', meta);
  process.exit(1);
}

const layers = await req('GET', `/api/jobs/${job.id}/exports/layers.json`);
console.log('layers', layers.status);
if (layers.status !== 200) process.exit(1);
const man = JSON.parse(layers.body.toString());
if (!(man.tileCount > 0)) {
  console.error('no tiles');
  process.exit(1);
}

const tile0 = man.tiles.find((t) => t.file);
const png = await req('GET', `/api/jobs/${job.id}/exports/${tile0.file}`);
console.log('tile', tile0.file, png.status, png.body.length);
if (png.status !== 200 || png.body.length < 50) process.exit(1);

const editBody = Buffer.from(
  JSON.stringify({
    version: 1,
    bgLayerId: tile0.id || 'tile_00001',
    nodes: { [tile0.id || 'tile_00001']: { visible: true, name: 'BG' } },
  }),
);
const put2 = await req(
  'PUT',
  `/api/jobs/${job.id}/scene-edit`,
  {
    'Content-Type': 'application/json',
    'Content-Length': editBody.length,
  },
  editBody,
);
console.log('scene-edit', put2.status, put2.body.toString());
if (put2.status !== 200) process.exit(1);

const ed = await req('GET', `/editor/?job=${job.id}`);
console.log('editor page', ed.status, ed.body.toString().includes('标为 BG'));
if (ed.status !== 200) process.exit(1);

console.log('M1.5 smoke OK', job.id, 'tiles', man.tileCount);
