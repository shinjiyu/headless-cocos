# base-ai-headless

Create-project default. Published as the
[`headless` branch](https://github.com/shinjiyu/baseAIAutoCocos/tree/headless)
of [baseAIAutoCocos](https://github.com/shinjiyu/baseAIAutoCocos).

Catalog: [../templates/README.md](../templates/README.md).

That repo is the Creator **3.8.8** AI tooling base: ViewWeaver + CocosMetaMCP,
no playable board / MainUI / CTA. Official Empty(2D) is the wrong starting
point — it has no `assets/` until the IDE first-opens it.

This flavor keeps the useful part of that shell and drops the IDE bridge.

| In | Out |
|----|-----|
| `extensions/viewweaver` | `extensions/cocos-meta-mcp` |
| `settings/v2` (3.8.8 modules) | `.cursor` MCP / preview-refresh skills |
| `assets/scene/PreviewBoot.scene` (Canvas + Camera) | Board / MainUI / CTA / symbol-library |
| `assets/scripts/views/` (ViewWeaver output) | e2e probes (`HeadlessProbe`, `HeroSprite`) |
| `assets/resources` marked `isBundle` | |

## Commands

```powershell
node spike/create-project.mjs --template base-ai --out D:\tempWorkspace\my-game
node spike/pack-base-ai-headless.mjs --from D:\tempWorkspace\baseAIAutoCocos
node spike/e2e-create-project.cjs
```

`--from <project> --no-mcp` copies an existing 3.8 tree and deletes MCP paths.

ViewWeaver after create: [viewweaver.md](viewweaver.md).
