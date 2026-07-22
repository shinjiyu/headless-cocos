const asar = require('@electron/asar');
const p = 'C:\\ProgramData\\cocos\\editors\\Creator\\3.8.8\\resources\\app.asar';
const list = asar.listPackage(p).filter((x) => String(x).includes('preview')).slice(0, 30);
console.log('sample entries:');
for (const e of list) console.log(JSON.stringify(e));
const candidates = [
  list[0],
  String(list[0] || '').replace(/^[\\/]+/, ''),
  'builtin/preview/package.json',
  '\\builtin\\preview\\package.json',
  '/builtin/preview/package.json',
];
for (const e of candidates) {
  if (!e) continue;
  try {
    const b = asar.extractFile(p, e);
    console.log('OK', JSON.stringify(e), b.length);
  } catch (err) {
    console.log('FAIL', JSON.stringify(e), err.message);
  }
}
