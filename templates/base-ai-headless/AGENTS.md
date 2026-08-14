# Headless Cocos project — no Creator IDE, no MCP

Preview is a **headless** service (`preview-mirror` + mini-packer + ViewWeaver host).

操作知识：先读本仓库 `AGENT_AUTHORING.md`（搭建时由 SETUP 入口拷入）。
Cursor skill：`.cursor/skills/headless-authoring/`。

搭建：

https://raw.githubusercontent.com/shinjiyu/headless-cocos/feat/artist-preview-design/AGENT_SETUP.md

## How preview updates

1. Edit files under `assets/`.
2. The preview process watches the disk.
3. Missing `.meta` files are minted; scripts are packed; prefabs can run ViewWeaver.
4. The browser receives HMR.

## ViewWeaver

- Output: `assets/scripts/views/<Name>/`
- HTTP: `GET/POST /__viewweaver`
- CLI: `node spike/viewweaver-host.mjs --project <this-dir> <PrefabName>`
- Do **not** pass `--regen-bind` unless you intend to rewrite the contract.

## Do not

- Call `cocosmcp` / Creator `Editor.Message` / any MCP bridge.
- Start Cocos Creator or refresh an IDE preview.
- Copy playable-ad Board / MainUI / CTA stubs into this shell unless the project is a PA.
