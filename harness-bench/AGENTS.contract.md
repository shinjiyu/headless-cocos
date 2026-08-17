# Harness bench contract (AIWS-shaped PA)

You are editing a **playable-ad (PA)** Cocos Creator **3.8** project fixture
that mirrors AIWS production paths (`MainUI` / `CTA` / `BoardAudioBinder` / harExplore).

## Do

- Edit files under `assets/` only (scripts, prefabs, cfg, audio, fx).
- Keep existing `.meta` UUIDs — never regenerate project UUIDs. Missing metas for new prefab/scene/script/folder files are minted by headless preview; do not invent your own.
- Prefer minimal surgical diffs (production users iterate in short Chinese follow-ups).
- Prefer static prefab nodes + view bindings over inventing dynamic UI nodes when the project already has genbot/prefab structure.

## Do not

- Call Cocos Creator IDE, MCP, `cocosmcp`, or `Editor.Message`. To regenerate View bindings, POST `/__viewweaver` or wait for headless watch — do not call `viewweaver/generate-for-ai`.
- Start Creator or invent a "refresh preview" tool.
- Edit files outside the project workspace.
- Delete or rewrite `.meta` files unless the task explicitly requires it.
- Use `bigwin` / `legend_win` outside CTA unless the task says so (production: legend_win is CTA-only).

Preview updates automatically when `assets/` changes via **Docker headless**
`cocos-headless-preview` (mini-packer + HMR). There is no Creator IDE in the loop.
