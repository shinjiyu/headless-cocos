# Headless agent demo — NO Cocos Creator IDE, NO MCP

This project is previewed by a **headless** Docker service (`preview-mirror` + mini-packer).

## How preview updates

1. You edit files under `assets/` (especially `assets/scripts/*.ts`).
2. The preview container detects the change (poll/watch).
3. Mini-packer rebuilds script chunks when needed.
4. Browser receives HMR reload.

## Do not

- Call `cocosmcp` / Creator `Editor.Message` / any MCP bridge.
- Try to start Cocos Creator or refresh an IDE preview.
- Wait for a "preview refresh" tool — it does not exist here.

## Preferred demo target

`assets/scripts/HeadlessProbe.ts` — bump `PROBE_VERSION` and/or `DEMO_LABEL`.
