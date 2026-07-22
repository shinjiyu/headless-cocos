from pathlib import Path
p = Path(r"d:/tempWorkspace/headless-cocos-research/spike/preview-mirror.mjs")
t = p.read_text(encoding="utf-8")
if "REQLOG" not in t:
    t = t.replace(
        "const LIBRARY = path.join(PROJECT, 'library');",
        "const LIBRARY = path.join(PROJECT, 'library');\nconst REQLOG = process.env.REQLOG || path.join(__dirname, 'requests.jsonl');",
    )
    t = t.replace(
        "console.log(req.method, urlPath);",
        """console.log(req.method, urlPath);
  const _start = Date.now();
  const _origEnd = res.end.bind(res);
  res.end = function (...args) {
    try {
      fs.appendFileSync(REQLOG, JSON.stringify({ t: Date.now(), ms: Date.now()-_start, method: req.method, url: urlPath, status: res.statusCode, via: res.getHeader && res.getHeader('X-Preview-Mirror') }) + '\\n');
    } catch {}
    return _origEnd(...args);
  };""",
    )
    p.write_text(t, encoding="utf-8")
    print("logging patched")
else:
    print("already patched")
