/**
 * MainUI.view — 盘面主界面逻辑精简桩（对齐 AIWS 真实改点）
 *
 * SEED BUGS (tasks fix these):
 * - WAIT_CLICK_BEFORE_MULTI = true（调试门闩，生产要关掉）
 * - thunderSfxDelay 偏晚
 * - score font 走系统字路径，不是 font_msgwin
 * - SLOGAN_MASK_W 过窄
 * - FORCE_DEBUG_HUD 开着
 */

import { Sfx } from "../../audio/Sfx";

/** SEED: debug gate before multi-collect */
export const WAIT_CLICK_BEFORE_MULTI = true;

/** SEED: lightning sfx late vs spine */
export const THUNDER_SFX_DELAY = 0.85;

/** SEED: too narrow vs board plate */
export const SLOGAN_MASK_W = 280;

/** SEED: debug HUD on */
export const FORCE_DEBUG_HUD = true;

/** SEED: wrong — should be harexplore bitmap font path */
export const SCORE_FONT_PATH = "internal/default-font";

/** Production target path (for graders / docs) */
export const MSGWIN_FONT_PATH =
  "fx/harexplore/power-of-thor2/font/font_msgwin/font_msgwin";

export class MainUIView {
  async runFlow() {
    Sfx.play("click");
    await this.playClearPhase();
    if (WAIT_CLICK_BEFORE_MULTI) {
      await this.waitUserClick(); // SEED debug
    }
    await this.playMultiCollect();
    this.openCta();
  }

  async playClearPhase() {
    // score should use SCORE_FONT_PATH / MSGWIN_FONT_PATH
    Sfx.play("score_num");
  }

  async playMultiCollect() {
    this.scheduleThunderSfx();
    Sfx.play("multi_collect", 1, 0);
  }

  scheduleThunderSfx() {
    // production: align with spine cast frame (~0.4s or less)
    setTimeout(() => Sfx.play("thunder_strike"), THUNDER_SFX_DELAY * 1000);
  }

  async waitUserClick() {
    return Promise.resolve();
  }

  openCta() {}
}
