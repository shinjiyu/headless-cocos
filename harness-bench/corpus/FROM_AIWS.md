# AIWS production → harness corpus

Source tasks: `D:/workspace/ae_meta_mcp/ai-game-workspace/data/tasks.json` (196).  
**Base project:** `templates/base-pa` ← copy of AIWS `smoke/demo/pa` (~473 files, ~17MB), then `scripts/seed-base-pa.mjs`.

## Production shape

| Kind | Count |
|------|------:|
| freeform agent | ~103 |
| layout | 45 |
| board-merge | 21 |
| harexplore | 20 |

Hot files: `MainUI.view.ts`, `CTA.*`, `BoardAudioBinder.ts`, spine/audio.

## Bench v3

Real PA + surgical SEED bugs (see `templates/base-pa/HARNESS_SEED.md`).  
Tasks T01–T10 ask agents to fix those seeds.  
`pa-mini` stubs are obsolete for default runs.
