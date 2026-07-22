const asar = require('@electron/asar');
const p = 'C:\\ProgramData\\cocos\\editors\\Creator\\3.8.8\\resources\\app.asar';
const list = asar.listPackage(p).filter((x) => String(x).includes('\\builtin\\preview\\package.json') || String(x).endsWith('preview\\package.json'));
console.log('pkg entries', list.map(JSON.stringify));
const e = list[0];
const variants = [
  e,
  e && e.slice(1),
  e && e.replace(/^\\/, ''),
  'builtin\\preview\\package.json',
  String.raw`builtin\preview\package.json`,
];
for (const v of variants) {
  if (!v) continue;
  try {
    const b = asar.extractFile(p, v);
    console.log('OK', JSON.stringify(v), b.length, b.slice(0, 80).toString());
  } catch (err) {
    console.log('FAIL', JSON.stringify(v), err.message);
  }
}
// also check if package.json is in list at all
const allPkg = asar.listPackage(p).filter((x) => /preview.*package\.json$/i.test(String(x)));
console.log('all preview package.json', allPkg.map(JSON.stringify));
