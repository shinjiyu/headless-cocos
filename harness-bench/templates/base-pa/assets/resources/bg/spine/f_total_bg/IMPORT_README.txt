Spine export from Cocos Creator HAR

Each pack folder contains:
  <name>/<name>.json   — Spine skeleton
  <name>/<name>.atlas  — Spine atlas text
  <name>/*.png|webp|jpg — Atlas texture pages (names must match .atlas first line per page)

Cocos Creator import:
  1. Copy pack folder(s) into assets/
  2. Keep texture filenames identical to .atlas page headers
  3. Reimport .json in the asset panel

Scatter in Golden Seth HAR: symbol_15, symbol_16 (no separate scatter_* blob).

Exported packs:
  f_total_bg [null] — 3 files