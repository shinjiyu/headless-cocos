const fs = require('fs');
const path = require('path');

function walk(dir) {
  let n = 0;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    try { fs.statSync(p); } catch {}
    n++;
    if (e.isDirectory()) n += walk(p);
  }
  return n;
}

for (const root of process.argv.slice(2)) {
  const t = Date.now();
  const n = walk(root);
  console.log(`${root}: entries=${n} ms=${Date.now() - t}`);
}
