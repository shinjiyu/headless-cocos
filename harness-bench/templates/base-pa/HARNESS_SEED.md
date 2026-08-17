# base-pa harness seeds

Source: AIWS `smoke/demo/pa` (real playable-ad Cocos 3.8 project).

| Task | Seed |
|------|------|
| T01 | CTA.prefab Mask UITransform width=220 |
| T02 | CTA.view open Sfx = bigwin |
| T03 | BoardAudioBinder missing symbol-vanish |
| T04 | WAIT_CLICK_BEFORE_SECOND=true |
| T05 | SCORE_USE_SYSTEM_FONT=true |
| T06 | score wired to symbol-vanish (should be symbol-win) |
| T07 | THUNDER_SFX_DELAY=0.85 |
| T08 | CTA btn.y=-50 (MainUI Btn ~-525) |
| T09 | MainUI Mask width=280 |
| T10 | FORCE_DEBUG_HUD=true |

Re-seed: `node scripts/seed-base-pa.mjs`
