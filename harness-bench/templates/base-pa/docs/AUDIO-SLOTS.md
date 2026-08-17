# 音频插槽清单

本工程的声音分两条通道：

1. **Sfx 全局服务（key 制）** — 业务代码只发字符串 key，资源按约定放在
   `assets/resources/audio/<key>.mp3`（ogg 也可）。**缺资源不报错**：只警告一次并静默，
   素材可以后补，放对文件名即自动生效。
2. **符号专属音效（clip 直连）** — 在 `symbol-library.prefab` 的 `SymbolDefs` 上按符号
   配置 AudioClip（`enterSound` / `winSound` / `vanishSound`），由 `SymbolView` 在该符号
   演出时直接播放，不走 key。换皮时随符号库一起替换。

以下为通道 1 的全部插槽。**换皮 / 补音频时对照本表放文件即可，不需要改代码。**

## 已有素材的插槽

| key | 文件 | 触发时机 | 触发点 |
| --- | --- | --- | --- |
| `bgm` | `bgm.mp3` | 背景音乐，循环。启动时先尝试自动播，被浏览器拦截则首个手势（触摸/鼠标/开始按钮）补播 | `MainEntry.onLoad` / `onUserInput`、`MainUIView.onClickBtn` |
| `click` | `click.mp3` | 按钮点击（开始按钮、CTA 领取按钮） | `MainUIView.onClickBtn`、`CTAView.onClickBtn` |
| `cta_in` | `cta_in.mp3` | CTA 结算页进场 | `CTAView.start` |
| `symbol_win` | `symbol_win.mp3` | 单格中奖高亮时刻（同帧多格由节流合并为一声） | `BoardAudioBinder`（`symbol-win` 事件） |
| `symbol_vanish` | `symbol_vanish.mp3` | 单格消除时刻（同上节流） | `BoardAudioBinder`（`symbol-vanish` 事件） |
| `score_num` | `score_num.mp3` | 金币/分数增加，每次加分滚动时 | `MainUIView.addScore` |
| `multiplier_up_1` | `multiplier_up_1.mp3` | 倍率球升档 → 50x（第 2 档点亮） | `MainUIView.animateBallOn` |
| `multiplier_up_2` | `multiplier_up_2.mp3` | 倍率球升档 → 250x（第 3 档点亮） | 同上 |
| `multiplier_up_3` | `multiplier_up_3.mp3` | 倍率球升档 → 500x（第 4 档点亮） | 同上 |

## 已预留、暂无素材的插槽（静默中）

| key | 触发时机 | 触发点 |
| --- | --- | --- |
| `symbol_land` | 单格符号落地时刻 | `BoardAudioBinder`（`symbol-land` 事件） |
| `board_enter` | 开场入盘转移开始（frameKind `enter-table`） | `BoardAudioBinder`（`transition-start`） |
| `reel_drop` | 补落/换盘落下转移开始（frameKind `reveal`） | 同上 |
| `win_fanfare` | 中奖高亮转移开始（frameKind `highlight`），整轮一声 | 同上 |
| `clear_whoosh` | 消除退场转移开始（frameKind `postClear`） | 同上 |
| `compact_slide` | 压缩下落转移开始（frameKind `compact`） | 同上 |

## 映射的维护位置

- 盘面事件 → key 的映射表：`assets/scripts/audio/BoardAudioBinder.ts`
  （`CELL_SFX` 单格时刻音、`TRANSITION_SFX` 帧转移整体音）。换风格改这一张表。
- UI / 流程音（bgm、click、cta_in、score_num、multiplier_up_*）：散在各触发点，key 直接写在调用处，
  全量搜索 `Sfx.play` / `Sfx.playBgm` 即可定位。
- 预载清单：`MainUIView.start` 里 `Sfx.preload([...BOARD_SFX_KEYS, "click", "score_num", "multiplier_up_1", "multiplier_up_2", "multiplier_up_3"])`；
  新增 UI 类 key 时记得补进去，避免首次触发有加载延迟。

## 素材规格建议

- 单声道；短音效 96kbps、BGM 80kbps 上下（当前素材即此规格，总量约 400KB）。
- 同一 key 有 90ms 节流窗（`Sfx` 内置），密集事件不需要在素材侧留静音尾。
