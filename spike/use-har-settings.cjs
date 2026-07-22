const fs = require('fs');
const path = require('path');

const harPath = path.join(__dirname, '../notes/har/settings.js');
const outPath = path.join(__dirname, 'cache/settings.js');
const uuid = '23ed0669-5d4b-4089-9483-04ac7220ee5a';

let s = fs.readFileSync(harPath, 'utf8').replace(/^\uFEFF/, '');
const m = s.match(/window\._CCSettings\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
if (!m) {
  console.error('parse fail');
  process.exit(1);
}
const settings = JSON.parse(m[1]);
settings.launch.launchScene = uuid;
settings.splashScreen = settings.splashScreen || {};
settings.splashScreen.logo = { type: 'none' };
settings.splashScreen.totalTime = 0;
const out = 'window._CCSettings = ' + JSON.stringify(settings) + ';';
fs.writeFileSync(outPath, out);
console.log('wrote har-based settings len', out.length, 'launch', settings.launch.launchScene);
console.log('builtins', settings.engine.builtinAssets.length);
console.log('modules', settings.engine.engineModules.join(','));
