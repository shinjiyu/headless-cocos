const asar = require('@electron/asar');
const fs = require('fs');
const path = require('path');
const asarPath = process.argv[2];
const destRoot = process.argv[3];
const prefixes = process.argv.slice(4);
const list = asar.listPackage(asarPath);
const prefs = prefixes.map((p) => p.replace(/\//g, '\\').replace(/^\\+/, '').toLowerCase());
const toKey = (fp) => String(fp).replace(/\//g, '\\').replace(/^\\+/, '').toLowerCase();
const targets = list.filter((fp) => {
  const n = toKey(fp);
  return prefs.some((pref) => n === pref || n.startsWith(pref + '\\'));
});
console.log('matched', targets.length);
let files = 0, dirs = 0, fail = 0;
for (const entry of targets) {
  const relAsar = String(entry).replace(/^\\+/, '');
  const out = path.join(destRoot, relAsar.replace(/\\/g, '/'));
  try {
    const buf = asar.extractFile(asarPath, relAsar);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, buf);
    files++;
  } catch (e) {
    if (/directory or link/i.test(e.message)) {
      fs.mkdirSync(out, { recursive: true });
      dirs++;
    } else {
      fail++;
      if (fail <= 5) console.log('FAIL', relAsar, e.message);
    }
  }
}
console.log('wrote', files, 'dirs', dirs, 'fail', fail);
