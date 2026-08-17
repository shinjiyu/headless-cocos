/**
 * Minimal Sfx facade (AIWS-shaped). Keys map to resources under assets/resources/audio/.
 */
const KEYS = new Set([
  "bigwin",
  "legend_win",
  "symbol_vanish",
  "score_num",
  "multi_collect",
  "thunder_strike",
  "click",
  "bgm",
]);

export const Sfx = {
  preload(_keys: string[]) {},
  play(key: string, _vol = 1, _delay = 0) {
    if (!KEYS.has(key)) console.warn(`[Sfx] unknown key ${key}`);
  },
  playBgm(key: string) {
    this.play(key);
  },
};
