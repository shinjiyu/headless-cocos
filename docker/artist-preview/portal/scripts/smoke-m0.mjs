import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const HOST = process.env.SMOKE_HOST || '127.0.0.1';
const PORT = Number(process.env.SMOKE_PORT || 8800);

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
            headers: res.headers,
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

const tmp = path.join(os.tmpdir(), 'm0-smoke.psd');
const buf = Buffer.concat([Buffer.from([0x38, 0x42, 0x50, 0x53]), Buffer.alloc(64, 7)]);
fs.writeFileSync(tmp, buf);

const boundary = `----m0smoke${Date.now()}`;
const body = Buffer.concat([
  Buffer.from(
    `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="file"; filename="m0-smoke.psd"\r\n' +
      'Content-Type: image/vnd.adobe.photoshop\r\n\r\n',
  ),
  buf,
  Buffer.from(`\r\n--${boundary}--\r\n`),
]);

const health = await req('GET', '/api/health');
console.log('health', health.status, health.body.toString());

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
const dl = await req('GET', `/api/jobs/${job.id}/psd`);
const match = Buffer.compare(dl.body, buf) === 0;
console.log('download', dl.status, 'bytes', dl.body.length, 'match', match);
if (!match) process.exit(1);

const prev = await req('GET', `/preview/${job.id}/`);
const placeholder = prev.body.toString().includes('尚未就绪');
console.log('preview', prev.status, 'placeholder', placeholder);
if (prev.status !== 200 || !placeholder) process.exit(1);

const conv = await req('POST', `/api/jobs/${job.id}/convert`);
console.log('convert', conv.status, conv.body.toString());
if (conv.status !== 501) process.exit(1);

const logs = await req('GET', `/api/jobs/${job.id}/logs`);
console.log('logs\n' + logs.body.toString());
console.log('M0 smoke OK', job.id);
