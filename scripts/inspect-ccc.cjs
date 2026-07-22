const fs = require('fs');
const path = require('path');
const files = [
  'd:/tempWorkspace/headless-cocos-research/extracted/3.8.8/builtin/preview/dist/contributions/server.ccc',
  'd:/tempWorkspace/headless-cocos-research/extracted/3.8.8/builtin/preview/dist/browser/preview-manager.ccc',
  'd:/tempWorkspace/headless-cocos-research/extracted/3.8.8/builtin/server/dist/express.ccc',
];
for (const f of files) {
  const b = fs.readFileSync(f);
  console.log('\n', path.basename(f));
  console.log('hex', b.slice(0, 32).toString('hex'));
  console.log('utf8 head', JSON.stringify(b.slice(0, 64).toString('utf8')));
  // count printable ratio
  let printable = 0;
  for (let i = 0; i < Math.min(b.length, 2000); i++) {
    const c = b[i];
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127)) printable++;
  }
  console.log('printable/2k', printable);
  // search known substrings as bytes
  for (const s of ['preview', 'settings', 'express', 'socket', 'reload', 'scripting', 'http']) {
    const idx = b.indexOf(Buffer.from(s));
    console.log('find', s, idx);
  }
}
