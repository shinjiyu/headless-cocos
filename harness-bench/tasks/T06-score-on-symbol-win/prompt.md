# T06 — 出分事件改回 symbol-win

`MainUI.view.ts` 的 `wireBoardEvents` 当前错误监听了 `symbol-vanish`（偏晚）。

改回监听 `symbol-win`（文件注释里的生产约定）。
