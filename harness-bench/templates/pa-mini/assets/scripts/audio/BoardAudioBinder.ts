/**
 * BoardAudioBinder — 盘面事件 → 音效 key（AIWS 生产同构）。
 * SEED BUG: symbol-vanish 故意未映射（T03 要补上）。
 */

import { Sfx } from "./Sfx";

export type BoardEvent = { type: string; frameKind?: string };

const CELL_SFX: Record<string, string> = {
  "symbol-land": "symbol_land",
  "symbol-win": "symbol_win",
  // SEED: missing "symbol-vanish" → "symbol_vanish"
};

const TRANSITION_SFX: Record<string, string> = {
  reveal: "reel_drop",
  highlight: "win_fanfare",
};

export function resolveBoardSfxKey(e: BoardEvent): string | undefined {
  if (e.type === "transition-start" && e.frameKind) {
    return TRANSITION_SFX[e.frameKind];
  }
  return CELL_SFX[e.type];
}

export function onBoardAudioEvent(e: BoardEvent): void {
  const key = resolveBoardSfxKey(e);
  if (!key) return;
  Sfx.play(key);
}

export function bindBoardAudio(on: (types: string[], cb: (e: BoardEvent) => void) => () => void) {
  return on(["symbol-land", "symbol-win", "symbol-vanish", "transition-start"], onBoardAudioEvent);
}
