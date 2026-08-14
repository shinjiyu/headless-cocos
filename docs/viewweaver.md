# Headless ViewWeaver

Prefab → typed View bindings **without** Creator, MCP, or `Editor.Message`.

New projects from `--template base-ai` already vendor `extensions/viewweaver`
(see [base-ai-headless.md](base-ai-headless.md)).

This is the generate-for-ai path. The preview stack does not reimplement the
generator; it runs the **project's own** CLI so output layout stays correct.

| Project extension | Output |
|---|---|
| `extensions/viewweaver` | `assets/scripts/views/<Name>/` |
| `extensions/genbot` (legacy) | `assets/scripts/_genbot/<Name>/` |

A foreign ViewWeaver copy is **never** used as fallback — that would migrate
`_genbot` → `views` and break existing imports.

## When it runs

1. **Watch** — a registered `.prefab` or its `.bind.json` changes.
2. **HTTP** — agent / script calls `POST /__viewweaver`.
3. **CLI** — `node spike/viewweaver-host.mjs --project <dir> CTA`.

Do **not** pass `--regen-bind` unless you intend to rewrite the contract
(can sweep `har_*` into bind). Layout-only prefab edits (X/Y/scale, swap
sprite UUID) still regenerate `.gen.ts`; if bind paths are unchanged the
file is effectively the same.

## HTTP

```
GET  /__viewweaver          → { available, tool, cli, prefabs, auto }
POST /__viewweaver          { "prefab": "CTA" }
POST /__viewweaver          { "prefab": "assets/resources/prefab/MainUI.prefab" }
POST /__viewweaver          { "all": true }
```

`prefab` may be registry name, project-relative path, absolute path, or uuid.

Disable auto-generate: `VIEWWEAVER=0`.

## CLI

```powershell
node spike/viewweaver-host.mjs --project D:\tempWorkspace\dsh-cocos-test --status
node spike/viewweaver-host.mjs --project D:\tempWorkspace\dsh-cocos-test CTA
node spike/viewweaver-host.mjs --project D:\tempWorkspace\dsh-cocos-test --all
```

Override CLI: `VIEWWEAVER_CLI=D:\path\to\cli.ts`.

## After generate

New `.ts` files get metas from `ensure-meta` on the next packer run (watch
already schedules `mini-build`). Preview HMR follows.

## Not this stack

Inspector bind checkboxes, `generate-from-asset` dialogs, and
`Editor.Message.request("viewweaver", "generate-for-ai")` stay in Creator.
Headless only needs the disk CLI.
