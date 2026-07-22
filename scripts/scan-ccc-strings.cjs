const fs = require('fs');
const path = require('path');
const files = [
  'builtin/preview/dist/browser/preview-manager.ccc',
  'builtin/preview/dist/browser/preview-settings.ccc',
  'builtin/preview/dist/browser/index.ccc',
  'builtin/preview/dist/contributions/server.ccc',
  'builtin/server/dist/express.ccc',
  'builtin/server/dist/index.ccc',
  'builtin/server/dist/socket.ccc',
];
const root = 'd:/tempWorkspace/headless-cocos-research/extracted/3.8.8';
const re = /[\/][A-Za-z0-9_\-\/.{}:]+|preview\/[A-Za-z0-9_\-\/.]+|scripting\/[A-Za-z0-9_\-\/.]+|reload-terminal|generate-settings|settings\.js|query-preview|_CCSettings|socket\.io|live.?reload/g;
for (const f of files) {
  const p = path.join(root, f);
  if (!fs.existsSync(p)) { console.log('MISS', f); continue; }
  const buf = fs.readFileSync(p);
  const text = buf.toString('utf8');
  const ascii = buf.toString('binary');
  const hits = new Set();
  for (const m of text.matchAll(/["'`](\/[A-Za-z0-9_\-\/.?=&%{}]+)["'`]/g)) hits.add(m[1]);
  for (const m of text.matchAll(/["'`]((?:preview|scripting|assets|scene|socket)[^"'`]{0,80})["'`]/g)) hits.add(m[1]);
  for (const m of text.matchAll(/["'`]([A-Za-z0-9_\-]+:[A-Za-z0-9_\-]+)["'`]/g)) {
    if (/preview|programming|reload|settings|scene|asset/i.test(m[1])) hits.add(m[1]);
  }
  console.log('\n====', f, 'size', buf.length, '====');
  [...hits].sort().slice(0, 80).forEach((h) => console.log(' ', h));
}
