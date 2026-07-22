const fs = require('fs');
const http = require('http');
const path = require('path');

const settingsPath = path.join(__dirname, 'cache', 'settings.js');
const uuid = '23ed0669-5d4b-4089-9483-04ac7220ee5a';

function patch(s) {
  return s.replace(/"launchScene"\s*:\s*"current_scene"/, `"launchScene":"${uuid}"`);
}

function fromCreator() {
  return new Promise((resolve, reject) => {
    const req = http.get('http://127.0.0.1:7456/settings.js', { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

(async () => {
  try {
    const r = await fromCreator();
    if (r.status === 200 && r.data.includes('_CCSettings')) {
      fs.writeFileSync(settingsPath, patch(r.data));
      console.log('resnapshot+patch from Creator, len=', r.data.length);
    } else {
      throw new Error('bad creator response ' + r.status);
    }
  } catch (e) {
    console.log('Creator unavailable:', e.message);
    if (!fs.existsSync(settingsPath)) {
      console.error('no settings.js cache');
      process.exit(1);
    }
    let s = fs.readFileSync(settingsPath, 'utf8');
    if (!s.includes('_CCSettings')) {
      console.error('settings.js looks corrupt');
      process.exit(1);
    }
    fs.writeFileSync(settingsPath, patch(s));
    console.log('patched existing cache');
  }
  const s = fs.readFileSync(settingsPath, 'utf8');
  const m = s.match(/"launchScene"\s*:\s*"[^"]+"/);
  console.log(m && m[0]);
  console.log('has _CCSettings', s.includes('_CCSettings'));
  console.log('len', s.length);
})();
