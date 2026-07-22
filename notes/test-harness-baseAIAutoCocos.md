# Test harness

- Repo: https://github.com/shinjiyu/baseAIAutoCocos
- Local: `d:\tempWorkspace\baseAIAutoCocos`
- Creator 3.8.8 opened with `--project` this path
- cocos-meta-mcp bridge: see `%LOCALAPPDATA%\cocos-meta-mcp\instances.json` (port dynamic; was **60107** on 2026-07-16)
- Preview HTTP: **7458** this session (`query-preview-url` returned `http://192.168.80.1:7458`)

## Bootstrap done in this checkout

- `assets/scene/PreviewBoot.scene` (imported as `cc.SceneAsset`)
- `assets/scripts/HeadlessProbe.ts` (probe for later)

## Agent self-test loop

```powershell
# switch MCP
# cocosmcp_use_project projectRoot=d:\tempWorkspace\baseAIAutoCocos

# health
Invoke-RestMethod http://127.0.0.1:<bridgePort>/health

# preview url
# eval: Editor.Message.request('preview','query-preview-url')
```

Live URL probe dump: `../notes/har/probe-7458.json`
