from pathlib import Path
p = Path(r"d:/tempWorkspace/headless-cocos-research/spike/preview-mirror.mjs")
t = p.read_text(encoding="utf-8")
# replace SOCKET_IO_STUB array definition
start = t.find("const SOCKET_IO_STUB = [")
end = t.find("].join('\\n');", start)
if start < 0:
    end = t.find('].join("\\n");', start)
if start < 0:
    raise SystemExit('stub not found')
# find end of join line
end2 = t.find("\n", end)
new_stub = """const SOCKET_IO_STUB = `System.register([], function (_export, _context) {
  return {
    execute: function () {
      function io() {
        return {
          on: function () { return this; },
          emit: function () { return this; },
          off: function () { return this; },
          disconnect: function () {},
        };
      }
      io.default = io;
      if (typeof window !== 'undefined') window.io = io;
      _export('default', io);
    }
  };
});`"""
# find original stub more carefully
import re
m = re.search(r"const SOCKET_IO_STUB = \[[\s\S]*?\]\.join\('\\\\n'\);", t)
if not m:
    m = re.search(r"const SOCKET_IO_STUB = \[[\s\S]*?\]\.join\(\"\\\\n\"\);", t)
if not m:
    # try current file form
    print(t[t.find('SOCKET_IO'):t.find('SOCKET_IO')+400])
    raise SystemExit('regex miss')
t = t[:m.start()] + new_stub + t[m.end():]
p.write_text(t, encoding='utf-8')
print('stub fixed')
