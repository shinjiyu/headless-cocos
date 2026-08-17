# T02 — CTA 开场音效改 legend_win

`assets/scripts/_genbot/CTA/CTA.view.ts` 里 `start()` 当前错误地 `Sfx.play("bigwin")`。

改成 `Sfx.play("legend_win")`（生产约定：legend_win 只给 CTA）。
