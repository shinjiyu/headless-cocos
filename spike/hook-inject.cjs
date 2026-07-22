// Runs inside Creator main process via cocosmcp_exec mode=eval.
// Wraps fs + child_process so we can log every write / spawn scoped to project.
(function () {
  const g = globalThis;
  if (g.__hcHook) {
    return { installed: false, note: 'already installed', logFile: g.__hcHook.logFile };
  }

  const fs = require('fs');
  const path = require('path');
  const cp = require('child_process');

  const PROJECT = 'd:\\tempWorkspace\\baseAIAutoCocos'.toLowerCase();
  const LOG_DIR = 'd:\\tempWorkspace\\headless-cocos-research\\trace';
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (e) {}
  const LOG_FILE = path.join(LOG_DIR, 'refresh-' + Date.now() + '.jsonl');
  const stream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

  function inScope(p) {
    if (typeof p !== 'string') return false;
    const low = p.toLowerCase();
    return low.startsWith(PROJECT);
  }
  function rec(op, data) {
    try {
      stream.write(JSON.stringify(Object.assign({ t: Date.now(), op }, data)) + '\n');
    } catch (e) {}
  }

  // ---- fs sync ops ----
  const syncWrites = ['writeFileSync', 'appendFileSync', 'unlinkSync', 'renameSync', 'copyFileSync', 'mkdirSync', 'rmdirSync', 'rmSync'];
  for (const name of syncWrites) {
    const orig = fs[name];
    if (typeof orig !== 'function') continue;
    fs[name] = function (a, b) {
      const p = typeof a === 'string' ? a : (a && a.toString ? a.toString() : '');
      const p2 = name === 'renameSync' || name === 'copyFileSync' ? (typeof b === 'string' ? b : '') : '';
      if (inScope(p) || inScope(p2)) rec('fs:' + name, { path: p, path2: p2 });
      return orig.apply(this, arguments);
    };
  }

  // ---- fs async callback ops ----
  const asyncWrites = ['writeFile', 'appendFile', 'unlink', 'rename', 'copyFile', 'mkdir', 'rmdir', 'rm'];
  for (const name of asyncWrites) {
    const orig = fs[name];
    if (typeof orig !== 'function') continue;
    fs[name] = function (a, b) {
      const p = typeof a === 'string' ? a : (a && a.toString ? a.toString() : '');
      const p2 = name === 'rename' || name === 'copyFile' ? (typeof b === 'string' ? b : '') : '';
      if (inScope(p) || inScope(p2)) rec('fs:' + name, { path: p, path2: p2 });
      return orig.apply(this, arguments);
    };
  }

  // ---- fs.promises ----
  const fp = fs.promises;
  const pWrites = ['writeFile', 'appendFile', 'unlink', 'rename', 'copyFile', 'mkdir', 'rmdir', 'rm'];
  for (const name of pWrites) {
    const orig = fp[name];
    if (typeof orig !== 'function') continue;
    fp[name] = function (a, b) {
      const p = typeof a === 'string' ? a : (a && a.toString ? a.toString() : '');
      const p2 = name === 'rename' || name === 'copyFile' ? (typeof b === 'string' ? b : '') : '';
      if (inScope(p) || inScope(p2)) rec('fsp:' + name, { path: p, path2: p2 });
      return orig.apply(this, arguments);
    };
  }

  // ---- child_process ----
  const cpOps = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'];
  for (const name of cpOps) {
    const orig = cp[name];
    if (typeof orig !== 'function') continue;
    cp[name] = function (cmd, args, opts) {
      let a = args;
      let cwd = '';
      if (Array.isArray(args)) {
        // spawn/execFile: (cmd, args, opts)
        cwd = (opts && opts.cwd) || '';
      } else if (args && typeof args === 'object') {
        // exec: (cmd, opts)
        cwd = args.cwd || '';
        a = null;
      }
      rec('cp:' + name, { cmd: String(cmd).slice(0, 500), args: Array.isArray(a) ? a.slice(0, 20) : null, cwd });
      return orig.apply(this, arguments);
    };
  }

  g.__hcHook = { logFile: LOG_FILE, installedAt: Date.now(), start: Date.now() };
  rec('meta:installed', { pid: process.pid, versions: process.versions });
  return { installed: true, logFile: LOG_FILE, pid: process.pid };
})();
