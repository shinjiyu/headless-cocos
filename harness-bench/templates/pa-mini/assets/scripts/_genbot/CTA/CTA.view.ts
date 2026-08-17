/**
 * CTA.view — 试玩结束弹层（AIWS 生产同构精简版）
 * SEED BUGS:
 * - 开场音效用 bigwin（应为 legend_win，且仅 CTA 可用）
 * - 按钮文案被错改成「开始」（应为「领取奖励」）
 */

import { Sfx } from "../../audio/Sfx";

export class CTAView {
  /** SEED: wrong sfx — production: legend_win only on CTA open */
  openSfxKey = "bigwin";

  /** SEED: wrong copy */
  claimBtnLabel = "开始";

  onShow(finalWin: number) {
    Sfx.play(this.openSfxKey, 1, 0);
    this.setWinAmount(finalWin);
    this.setClaimLabel(this.claimBtnLabel);
  }

  setWinAmount(_n: number) {}
  setClaimLabel(_s: string) {}
}
