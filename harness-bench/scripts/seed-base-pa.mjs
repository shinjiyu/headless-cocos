/**
 * Seed deterministic "bugs" into templates/base-pa so AIWS-shaped tasks have
 * a real Cocos PA to edit. Idempotent (looks for HARNESS_SEED markers).
 *
 * Usage: node scripts/seed-base-pa.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../templates/base-pa");

function read(p) {
  return fs.readFileSync(p, "utf8");
}
function write(p, s) {
  fs.writeFileSync(p, s, "utf8");
  console.log("seeded", path.relative(ROOT, p));
}

function seedCtaView() {
  const p = path.join(ROOT, "assets/scripts/_genbot/CTA/CTA.view.ts");
  let s = read(p);
  // T02: wrong open sfx
  s = s.replace(/Sfx\.play\("cta_in"\);/, 'Sfx.play("bigwin"); // HARNESS_SEED T02 wrong open sfx');
  s = s.replace(/Sfx\.play\("legend_win"\); \/\/ HARNESS_SEED T02.*/, 'Sfx.play("bigwin"); // HARNESS_SEED T02 wrong open sfx');
  if (!s.includes("HARNESS_SEED T02")) {
    throw new Error("T02 seed failed: cta_in/bigwin site missing");
  }
  write(p, s);
}

function seedBoardAudio() {
  const p = path.join(ROOT, "assets/scripts/audio/BoardAudioBinder.ts");
  let s = read(p);
  // T03: drop symbol-vanish mapping
  s = s.replace(
    /\n\s*"symbol-vanish":\s*"symbol_vanish",?/,
    '\n    // HARNESS_SEED T03: "symbol-vanish": "symbol_vanish" removed',
  );
  if (!s.includes("HARNESS_SEED T03")) {
    // already seeded or missing — ensure vanish not mapped
    if (/["']symbol-vanish["']\s*:/.test(s) && !s.includes("HARNESS_SEED T03")) {
      throw new Error("T03 seed failed");
    }
  }
  write(p, s);
}

function seedMainUIView() {
  const p = path.join(ROOT, "assets/scripts/_genbot/MainUI/MainUI.view.ts");
  let s = read(p);

  if (!s.includes("HARNESS_SEED_CONSTS")) {
    s = s.replace(
      /const TIP_CYCLE_INTERVAL = 2;/,
      `const TIP_CYCLE_INTERVAL = 2;

// ---- HARNESS_SEED_CONSTS (bench corpus) ----
/** T04: debug gate — first segment stops and waits for second click */
export const WAIT_CLICK_BEFORE_SECOND = true;
/** T07: thunder sfx late vs spine */
export const THUNDER_SFX_DELAY = 0.85;
/** T05: prefer system font instead of project bitmap intent */
export const SCORE_USE_SYSTEM_FONT = true;
/** T10: leave test HUD on */
export const FORCE_DEBUG_HUD = true;
// ---- end HARNESS_SEED_CONSTS ----`,
    );
  }

  // T04: gate second segment behind WAIT_CLICK_BEFORE_SECOND
  if (!s.includes("HARNESS_SEED T04")) {
    s = s.replace(
      /void board\.director\.playRange\(0, FIRST_SEGMENT_END\)\.then\(\(\) => \{\s*this\._phase = "waiting";\s*this\.updateHandGuide\(\);\s*\}\);/,
      `void board.director.playRange(0, FIRST_SEGMENT_END).then(() => {
                // HARNESS_SEED T04: stop for second click (production wants auto-continue)
                if (WAIT_CLICK_BEFORE_SECOND) {
                    this._phase = "waiting";
                    this.updateHandGuide();
                    return;
                }
                this._phase = "second";
                this.updateHandGuide();
                void board.director.playRange(FIRST_SEGMENT_END, board.doc.states.length - 1).then(() => {
                    this._phase = "done";
                    this.updateHandGuide();
                    this.onAllPlayed?.();
                });
            });`,
    );
  }

  // T07: schedule late thunder on first click
  if (!s.includes("HARNESS_SEED T07")) {
    s = s.replace(
      /Sfx\.play\("click"\);\s*\n\s*if \(this\._phase === "idle"\) \{/,
      `Sfx.play("click");
        // HARNESS_SEED T07: thunder intentionally late
        this.scheduleOnce(() => Sfx.play("thunder_strike"), THUNDER_SFX_DELAY);

        if (this._phase === "idle") {`,
    );
  }

  // T05: stamp system-font intent on score refresh
  if (!s.includes("HARNESS_SEED T05")) {
    s = s.replace(
      /private refreshScoreLabel\(\): void \{\s*this\.totalLabel\.string = /,
      `private refreshScoreLabel(): void {
        // HARNESS_SEED T05
        this.totalLabel.useSystemFont = SCORE_USE_SYSTEM_FONT;
        this.totalLabel.string = `,
    );
  }

  // T10: debug HUD string pollution (after T05 may already have rewritten refreshScoreLabel)
  if (!s.includes("HARNESS_SEED T10")) {
    if (s.includes("this.totalLabel.string = formatThousands(this._displayScore);")) {
      s = s.replace(
        /this\.totalLabel\.string = formatThousands\(this\._displayScore\);/,
        `// HARNESS_SEED T10
        this.totalLabel.string = FORCE_DEBUG_HUD
            ? \`DEBUG \${formatThousands(this._displayScore)}\`
            : formatThousands(this._displayScore);`,
      );
    }
  }

  // T06: wrong board event for scoring (production comment prefers symbol-win)
  if (!s.includes("HARNESS_SEED T06")) {
    s = s.replace(
      /board\.director\.events\.on\("symbol-win"/,
      `board.director.events.on("symbol-vanish" /* HARNESS_SEED T06 wrong timing; should be symbol-win */`,
    );
  }

  write(p, s);
}

function seedCtaPrefab() {
  const p = path.join(ROOT, "assets/resources/prefab/CTA.prefab");
  const arr = JSON.parse(read(p));
  // Mask node index 10 → UITransform 29
  const ut = arr[29];
  if (!ut || ut.__type__ !== "cc.UITransform") throw new Error("CTA Mask UITransform missing");
  ut._contentSize.width = 220; // T01 too narrow
  // btn node 38
  const btn = arr[38];
  if (!btn || btn._name !== "btn") throw new Error("CTA btn missing");
  btn._lpos.y = -50; // T08 wrong vs MainUI Btn ~-525
  write(p, JSON.stringify(arr, null, 2) + "\n");
}

function seedMainUIPrefab() {
  const p = path.join(ROOT, "assets/resources/prefab/MainUI.prefab");
  const arr = JSON.parse(read(p));
  // Mask UITransform 175 — T09 slogan/board mask too narrow
  const ut = arr[175];
  if (!ut || ut.__type__ !== "cc.UITransform") throw new Error("MainUI Mask UITransform missing");
  ut._contentSize.width = 280;
  write(p, JSON.stringify(arr, null, 2) + "\n");
}

function writeMarker() {
  write(
    path.join(ROOT, "HARNESS_SEED.md"),
    `# base-pa harness seeds

Source: AIWS \`smoke/demo/pa\` (real playable-ad Cocos 3.8 project).

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

Re-seed: \`node scripts/seed-base-pa.mjs\`
`,
  );
}

seedCtaView();
seedBoardAudio();
seedMainUIView();
seedCtaPrefab();
seedMainUIPrefab();
writeMarker();
console.log("OK base-pa seeded at", ROOT);
