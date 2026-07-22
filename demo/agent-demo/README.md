# Headless Agent Demo

**Cursor / stub writes files → Docker headless preview HMR.**  
No Cocos Creator IDE. No MCP (`cocosmcp`).

```text
Browser :8790  (ops UI + iframe)
    │
    ├─ POST /api/run  → agent container
    │                     └─ edits /workspace/assets/**  (bind mount)
    │
Browser :7470  ← preview container watches same mount → mini-packer → HMR
```

## Why no MCP

Old AIWS loop: Cursor → **MCP** → Creator `refresh-asset` / IDE preview.  
This demo: Cursor → **filesystem only** → `preview-mirror` poll/watch + packer.

`AGENTS.md` is written into the project on agent start so the local agent
is told MCP does not exist.

## One-command

```powershell
cd d:\tempWorkspace\headless-cocos-research
docker compose -f docker/docker-compose.agent-demo.yml up --build
```

Open **http://127.0.0.1:8790/**

1. Default backend **stub** — bumps `HeadlessProbe.PROBE_VERSION` (no API key).
2. Wait ~1–2s, preview iframe reloads; console shows new `ready v=…`.

## Real Cursor SDK

```powershell
# optional: copy key (do not commit)
# from AIWS secrets or https://cursor.com/dashboard/integrations
$env:CURSOR_API_KEY = "cursor_..."
# or write docker/.env.agent-demo

$env:BACKEND = "sdk"
docker compose -f docker/docker-compose.agent-demo.yml up --build
```

In the UI pick **cursor sdk**, click Run.

> Linux container runs `@cursor/sdk` with `local.cwd=/workspace`.  
> If local agent runtime fails in Docker on your machine, run the agent UI on the host (same contract):

```powershell
cd demo\agent-demo
npm install
$env:PROJECT_ROOT = "d:\tempWorkspace\baseAIAutoCocos"
$env:PREVIEW_URL = "http://127.0.0.1:7470/"
$env:BACKEND = "sdk"
$env:CURSOR_API_KEY = "..."
node server.mjs
```

(Keep the preview container up.)

# Prompt iteration framework

Goal: **make Cursor faster** by learning which files past agents actually Read/Write.

```text
Run (sdk)
  → mine transcript (Read/Write/tool list + wall ms)
  → update .ai-workspace/prompt-iter/kb.json + runs.jsonl
  → next prompt injects "Project memory / hot files"
  → fewer Glob **/* → lower ms
```

| Path | Role |
|------|------|
| `lib/transcript-mine.mjs` | Parse agent JSONL |
| `lib/prompt-kb.mjs` | KB + `buildPrompt()` |
| `GET /api/kb` | Inspect KB |
| `GET /api/runs` | Recent runs |
| `POST /api/kb/rescan` | Rebuild hot files from all transcripts |

UI: **Rescan logs → KB**, and after each Run the log shows `learned reads=[...]`.
