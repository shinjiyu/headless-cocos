# `spike/` — runtime

Implementation of the headless Creator 3.8 preview stack.

| Entry | Purpose |
|-------|---------|
| `preview-mirror.mjs` | HTTP + WebSocket preview server |
| `packer/build.cjs` | Mini TypeScript packer |
| `importers/` | Asset → `library/` importers |
| `e2e-*.cjs` / `probe-*.cjs` | Verification scripts |
| `snapshot-from-creator.cjs` | Build `engine-snapshot/` from a Creator install |

Full documentation: **[../README.md](../README.md)** and **[../docs/](../docs/)**.

```powershell
$env:PACKER = "mini"
$env:PORT = "7460"
$env:PROJECT = "D:\path\to\project"
$env:ENGINE_SNAPSHOT = "$PWD\engine-snapshot"
node .\preview-mirror.mjs
```
