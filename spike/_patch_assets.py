from pathlib import Path
p = Path(r"d:/tempWorkspace/headless-cocos-research/spike/preview-mirror.mjs")
t = p.read_text(encoding="utf-8")
old = "  return null;\n}"
new = """  const im = p.match(/^\\/assets\\/general\\/import\\/([0-9a-fA-F]{2})\\/([0-9a-fA-F-]{36})\\.json$/);
  if (im) return path.join(LIBRARY, im[1], im[2] + '.json');
  const nat = p.match(/^\\/assets\\/general\\/native\\/([0-9a-fA-F]{2})\\/([0-9a-fA-F-]{36})(.*)$/);
  if (nat) {
    const baseFile = path.join(LIBRARY, nat[1], nat[2] + nat[3]);
    if (fs.existsSync(baseFile)) return baseFile;
  }
  if (p === '/assets/main/config.json') return path.join(CACHE, 'assets/main/config.json');
  if (p === '/assets/main/index.js') return path.join(CACHE, 'assets/main/index.js');
  if (p === '/assets/internal/config.json') return path.join(CACHE, 'assets/internal/config.json');
  if (p === '/assets/internal/index.js') return path.join(CACHE, 'assets/internal/index.js');
  return null;
}"""
idx = t.rfind(old)
if idx < 0:
    raise SystemExit("anchor missing")
t = t[:idx] + new + t[idx+len(old):]
p.write_text(t, encoding="utf-8")
print("patched")
