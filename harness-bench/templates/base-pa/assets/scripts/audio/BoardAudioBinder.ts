/**
 * BoardAudioBinder — 盘面事件 → 音效 key 的映射层。
 *
 * 只订阅 BoardEvents，不入侵 BoardDirector / 动画模板。
 * 映射表是本 playable 项目的风格资产，换皮时改这一张表即可。
 *
 * 音效查找顺序（符号专属音效在 SymbolDefs 上配置、由 SymbolView 直播），
 * 这里只负责「盘面通用」层：单格时刻音 + 帧转移整体音。
 */

import type { IrFrameKind } from "../editor-core/index";
import type { BoardEvent, BoardEvents } from "../editor-app/boardEvents";
import { ALL_BOARD_EVENTS } from "../editor-app/boardEvents";
import { Sfx } from "./Sfx";

/** 单格时刻 → 音效 key（Sfx 内置按 key 节流，同帧多格只响一声） */
const CELL_SFX: Partial<Record<BoardEvent["type"], string>> = {
    "symbol-land": "symbol_land",
    "symbol-win": "symbol_win",
    // HARNESS_SEED T03: "symbol-vanish": "symbol_vanish" removed
};

/** 帧转移开始 → 音效 key（按 frameKind 区分整体演出音） */
const TRANSITION_SFX: Partial<Record<IrFrameKind, string>> = {
    "enter-table": "board_enter",
    reveal: "reel_drop",
    highlight: "win_fanfare",
    postClear: "clear_whoosh",
    compact: "compact_slide",
};

/** 需要预载的全部盘面音效 key（仅已有/计划中的 key） */
export const BOARD_SFX_KEYS: string[] = [
    ...Object.values(CELL_SFX),
    ...Object.values(TRANSITION_SFX),
].filter((k): k is string => typeof k === "string" && k.length > 0);

function resolveBoardSfxKey(e: BoardEvent): string | undefined {
    if (e.type === "transition-start" && e.frameKind) {
        return TRANSITION_SFX[e.frameKind];
    }
    return CELL_SFX[e.type];
}

function onBoardAudioEvent(e: BoardEvent): void {
    const key = resolveBoardSfxKey(e);
    if (!key) return;
    try {
        Sfx.play(key);
    } catch (err) {
        console.warn(`[BoardAudioBinder] Sfx.play('${key}') failed`, err);
    }
}

/**
 * 把盘面事件绑到 Sfx。返回解绑函数。
 */
export function bindBoardAudio(events: BoardEvents): () => void {
    return events.on(ALL_BOARD_EVENTS, onBoardAudioEvent);
}
