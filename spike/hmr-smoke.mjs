import WebSocket from 'ws';
import fs from 'fs';

const ws = new WebSocket('ws://127.0.0.1:7460/__hmr');
const got = [];

ws.on('message', (d) => {
  got.push(String(d));
  console.log('recv', String(d));
});

ws.on('error', (e) => {
  console.error(e);
  process.exit(1);
});

ws.on('open', async () => {
  await new Promise((r) => setTimeout(r, 200));
  const r = await fetch('http://127.0.0.1:7460/__reload', { method: 'POST' });
  console.log('reload status', r.status, await r.text());
  await new Promise((r) => setTimeout(r, 300));

  const p =
    'd:/tempWorkspace/baseAIAutoCocos/temp/programming/packer-driver/targets/preview/import-map.json';
  const t = Date.now();
  fs.utimesSync(p, t / 1000, t / 1000);
  console.log('touched', p);
  await new Promise((r) => setTimeout(r, 900));

  console.log('messages', got.length);
  ws.close();
  process.exit(got.some((x) => x.includes('browser:reload')) ? 0 : 2);
});
