# T04 — 去掉第二段前的调试点击等待

`assets/scripts/_genbot/MainUI/MainUI.view.ts`：

- 将 `WAIT_CLICK_BEFORE_SECOND` 设为 `false`，使第一段播完后自动进入第二段（不必再点一次开始）。
