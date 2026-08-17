import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bench = path.resolve(__dirname, "..");

/** Tasks aligned to seeded templates/base-pa (real AIWS smoke PA). */
const tasks = [
  {
    id: "T01-cta-mask-width",
    tier: "easy",
    tags: ["prefab", "cta", "layout"],
    source: "AIWS: CTA的mask 好像宽度有问题",
    prompt: `# T01 — CTA Mask 宽度

工程：真实 PA（\`templates/base-pa\`，源自 AIWS smoke/demo/pa）。

CTA 的 Mask 过窄，内容被裁切。

改 \`assets/resources/prefab/CTA.prefab\`：
- 找到节点 \`Mask\` 上的 \`cc.UITransform\`，把 \`_contentSize.width\` 从 **220** 加宽到 **至少 700**（高度可保持 1280）。
- 不要改无关节点；不要动 .meta UUID。
`,
    expect: {
      id: "T01-cta-mask-width",
      files: ["assets/resources/prefab/CTA.prefab"],
      forbidMetaRewrite: true,
      checks: [
        {
          type: "regex",
          file: "assets/resources/prefab/CTA.prefab",
          pattern: '"width"\\s*:\\s*(7\\d{2}|[89]\\d{2}|[1-9]\\d{3,})',
          message: "some UITransform width >= 700 (Mask restored)",
        },
        {
          type: "not_regex",
          file: "assets/resources/prefab/CTA.prefab",
          pattern: '"_name"\\s*:\\s*"Mask"[\\s\\S]{0,800}?"width"\\s*:\\s*220\\b',
          message: "Mask must not stay at width 220",
        },
      ],
    },
  },
  {
    id: "T02-cta-sfx-legend-win",
    tier: "easy",
    tags: ["script", "sfx", "cta"],
    source: "AIWS: CTA音效改成 legend win（仅 CTA）",
    prompt: `# T02 — CTA 开场音效改 legend_win

\`assets/scripts/_genbot/CTA/CTA.view.ts\` 里 \`start()\` 当前错误地 \`Sfx.play("bigwin")\`。

改成 \`Sfx.play("legend_win")\`（生产约定：legend_win 只给 CTA）。
`,
    expect: {
      id: "T02-cta-sfx-legend-win",
      files: ["assets/scripts/_genbot/CTA/CTA.view.ts"],
      forbidMetaRewrite: true,
      checks: [
        {
          type: "regex",
          file: "assets/scripts/_genbot/CTA/CTA.view.ts",
          pattern: 'Sfx\\.play\\(\\s*["\']legend_win["\']',
          message: "must play legend_win on CTA open",
        },
        {
          type: "not_regex",
          file: "assets/scripts/_genbot/CTA/CTA.view.ts",
          pattern: 'Sfx\\.play\\(\\s*["\']bigwin["\']',
          message: "bigwin must not remain as CTA open sfx",
        },
      ],
    },
  },
  {
    id: "T03-symbol-vanish-sfx",
    tier: "easy",
    tags: ["script", "sfx", "board"],
    source: "AIWS: 每一个球消除触发音效",
    prompt: `# T03 — 每个球消除触发音效

\`assets/scripts/audio/BoardAudioBinder.ts\` 的 \`CELL_SFX\` 里缺了消除映射。

补回：

\`"symbol-vanish": "symbol_vanish"\`
`,
    expect: {
      id: "T03-symbol-vanish-sfx",
      files: ["assets/scripts/audio/BoardAudioBinder.ts"],
      forbidMetaRewrite: true,
      checks: [
        {
          type: "regex",
          file: "assets/scripts/audio/BoardAudioBinder.ts",
          pattern: '["\']symbol-vanish["\']\\s*:\\s*["\']symbol_vanish["\']',
          message: "must map symbol-vanish → symbol_vanish",
        },
      ],
    },
  },
  {
    id: "T04-remove-debug-click-gate",
    tier: "medium",
    tags: ["script", "logic", "mainui"],
    source: "AIWS: 倍率收集/第二段前等点击是调试逻辑，去掉",
    prompt: `# T04 — 去掉第二段前的调试点击等待

\`assets/scripts/_genbot/MainUI/MainUI.view.ts\`：

- 将 \`WAIT_CLICK_BEFORE_SECOND\` 设为 \`false\`，使第一段播完后自动进入第二段（不必再点一次开始）。
`,
    expect: {
      id: "T04-remove-debug-click-gate",
      files: ["assets/scripts/_genbot/MainUI/MainUI.view.ts"],
      forbidMetaRewrite: true,
      checks: [
        {
          type: "regex",
          file: "assets/scripts/_genbot/MainUI/MainUI.view.ts",
          pattern: "WAIT_CLICK_BEFORE_SECOND\\s*=\\s*false",
          message: "WAIT_CLICK_BEFORE_SECOND must be false",
        },
        {
          type: "not_regex",
          file: "assets/scripts/_genbot/MainUI/MainUI.view.ts",
          pattern: "WAIT_CLICK_BEFORE_SECOND\\s*=\\s*true",
          message: "debug gate must not stay true",
        },
      ],
    },
  },
  {
    id: "T05-score-font-system-off",
    tier: "medium",
    tags: ["script", "font", "mainui"],
    source: "AIWS: 分数不要用系统字",
    prompt: `# T05 — 关闭分数系统字

\`MainUI.view.ts\` 里 \`SCORE_USE_SYSTEM_FONT\` 当前为 \`true\`（SEED）。

改为 \`false\`，让分数 Label 走工程字体而不是系统字。
`,
    expect: {
      id: "T05-score-font-system-off",
      files: ["assets/scripts/_genbot/MainUI/MainUI.view.ts"],
      forbidMetaRewrite: true,
      checks: [
        {
          type: "regex",
          file: "assets/scripts/_genbot/MainUI/MainUI.view.ts",
          pattern: "SCORE_USE_SYSTEM_FONT\\s*=\\s*false",
          message: "SCORE_USE_SYSTEM_FONT must be false",
        },
        {
          type: "not_regex",
          file: "assets/scripts/_genbot/MainUI/MainUI.view.ts",
          pattern: "SCORE_USE_SYSTEM_FONT\\s*=\\s*true",
          message: "system font flag must not stay true",
        },
      ],
    },
  },
  {
    id: "T06-score-on-symbol-win",
    tier: "medium",
    tags: ["script", "board", "timing", "mainui"],
    source: "AIWS: 出分时机应对齐高亮/消除开始（symbol-win）",
    prompt: `# T06 — 出分事件改回 symbol-win

\`MainUI.view.ts\` 的 \`wireBoardEvents\` 当前错误监听了 \`symbol-vanish\`（偏晚）。

改回监听 \`symbol-win\`（文件注释里的生产约定）。
`,
    expect: {
      id: "T06-score-on-symbol-win",
      files: ["assets/scripts/_genbot/MainUI/MainUI.view.ts"],
      forbidMetaRewrite: true,
      checks: [
        {
          type: "regex",
          file: "assets/scripts/_genbot/MainUI/MainUI.view.ts",
          pattern: 'events\\.on\\(\\s*["\']symbol-win["\']',
          message: "must listen symbol-win for scoring",
        },
        {
          type: "not_regex",
          file: "assets/scripts/_genbot/MainUI/MainUI.view.ts",
          pattern: 'events\\.on\\(\\s*["\']symbol-vanish["\']',
          message: "must not score on symbol-vanish",
        },
      ],
    },
  },
  {
    id: "T07-thunder-sfx-earlier",
    tier: "medium",
    tags: ["script", "sfx", "timing"],
    source: "AIWS: 闪电音效有点晚了",
    prompt: `# T07 — 雷击音提前

\`MainUI.view.ts\` 中 \`THUNDER_SFX_DELAY\` 当前为 \`0.85\`。

改为 **0.4 或更小**。
`,
    expect: {
      id: "T07-thunder-sfx-earlier",
      files: ["assets/scripts/_genbot/MainUI/MainUI.view.ts"],
      forbidMetaRewrite: true,
      checks: [
        {
          type: "regex",
          file: "assets/scripts/_genbot/MainUI/MainUI.view.ts",
          pattern: "THUNDER_SFX_DELAY\\s*=\\s*0\\.[0-4]\\d*",
          message: "THUNDER_SFX_DELAY must be <= 0.4",
        },
        {
          type: "not_regex",
          file: "assets/scripts/_genbot/MainUI/MainUI.view.ts",
          pattern: "THUNDER_SFX_DELAY\\s*=\\s*0\\.85",
          message: "old 0.85 delay must be gone",
        },
      ],
    },
  },
  {
    id: "T08-cta-btn-align-start",
    tier: "medium",
    tags: ["prefab", "layout", "cta"],
    source: "AIWS: CTA BTN 位置和开始 BTN 相同",
    prompt: `# T08 — CTA btn 对齐 MainUI 开始按钮

参考 \`MainUI.prefab\` 节点 \`Btn\` 的 y（约 **-524.8**）。

把 \`CTA.prefab\` 节点 \`btn\` 的 \`_lpos.y\` 从 **-50** 改成 **-524.8**（或与 MainUI Btn 一致；允许四舍五入到整数 -525）。
`,
    expect: {
      id: "T08-cta-btn-align-start",
      files: ["assets/resources/prefab/CTA.prefab"],
      forbidMetaRewrite: true,
      checks: [
        {
          type: "regex",
          file: "assets/resources/prefab/CTA.prefab",
          pattern: '"_name"\\s*:\\s*"btn"[\\s\\S]{0,200}?"y"\\s*:\\s*-525(?:\\.\\d+)?\\b|"_name"\\s*:\\s*"btn"[\\s\\S]{0,200}?"y"\\s*:\\s*-524(?:\\.\\d+)?\\b',
          message: "CTA btn y must align near MainUI Btn (~-525)",
        },
        {
          type: "not_regex",
          file: "assets/resources/prefab/CTA.prefab",
          pattern: '"_name"\\s*:\\s*"btn"[\\s\\S]{0,200}?"y"\\s*:\\s*-50\\b',
          message: "old btn y -50 must be gone",
        },
      ],
    },
  },
  {
    id: "T09-mainui-mask-width",
    tier: "hard",
    tags: ["prefab", "layout", "mask", "mainui"],
    source: "AIWS: mask 宽度太小 / 顶到底板",
    prompt: `# T09 — MainUI Mask 加宽

\`MainUI.prefab\` 根 \`Mask\` 的 UITransform \`width\` 被 SEED 成 **280**。

改回 **至少 720**（与设计稿全屏底板一致）。
`,
    expect: {
      id: "T09-mainui-mask-width",
      files: ["assets/resources/prefab/MainUI.prefab"],
      forbidMetaRewrite: true,
      checks: [
        {
          type: "regex",
          file: "assets/resources/prefab/MainUI.prefab",
          pattern: '"width"\\s*:\\s*(7\\d{2}|[89]\\d{2}|[1-9]\\d{3,})',
          message: "MainUI should have width >= 720 again",
        },
        {
          type: "not_regex",
          file: "assets/resources/prefab/MainUI.prefab",
          pattern: '"_name"\\s*:\\s*"Mask"[\\s\\S]{0,800}?"width"\\s*:\\s*280\\b',
          message: "Mask must not stay at width 280",
        },
      ],
    },
  },
  {
    id: "T10-turn-off-debug-hud",
    tier: "hard",
    tags: ["script", "mainui", "cleanup"],
    source: "AIWS: 把测试加的去掉",
    prompt: `# T10 — 关掉调试 HUD

\`MainUI.view.ts\` 中 \`FORCE_DEBUG_HUD\` 当前为 \`true\`（分数会显示 \`DEBUG …\`）。

改为 \`false\`。
`,
    expect: {
      id: "T10-turn-off-debug-hud",
      files: ["assets/scripts/_genbot/MainUI/MainUI.view.ts"],
      forbidMetaRewrite: true,
      checks: [
        {
          type: "regex",
          file: "assets/scripts/_genbot/MainUI/MainUI.view.ts",
          pattern: "FORCE_DEBUG_HUD\\s*=\\s*false",
          message: "FORCE_DEBUG_HUD must be false",
        },
        {
          type: "not_regex",
          file: "assets/scripts/_genbot/MainUI/MainUI.view.ts",
          pattern: "FORCE_DEBUG_HUD\\s*=\\s*true",
          message: "debug HUD must not stay true",
        },
      ],
    },
  },
];

const catalog = {
  version: 3,
  projectTemplate: "harness-bench/templates/base-pa",
  notes:
    "Real AIWS smoke/demo/pa copied to templates/base-pa, then HARNESS_SEED bugs applied. Re-seed: node scripts/seed-base-pa.mjs",
  aiwsSource: "D:/workspace/ae_meta_mcp/ai-game-workspace/data/aiws-data/workspaces/smoke/demo/pa",
  tasks: tasks.map((t) => ({
    id: t.id,
    tier: t.tier,
    tags: t.tags,
    source: t.source,
  })),
};

// remove old v2 task dirs (keep legacy probe)
for (const name of fs.readdirSync(path.join(bench, "tasks"))) {
  if (!name.startsWith("T")) continue;
  const full = path.join(bench, "tasks", name);
  if (fs.statSync(full).isDirectory()) {
    fs.rmSync(full, { recursive: true, force: true });
  }
}

fs.writeFileSync(
  path.join(bench, "tasks/catalog.json"),
  JSON.stringify(catalog, null, 2) + "\n",
);

for (const t of tasks) {
  const dir = path.join(bench, "tasks", t.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "prompt.md"), t.prompt.trim() + "\n");
  fs.writeFileSync(
    path.join(dir, "expect.json"),
    JSON.stringify(t.expect, null, 2) + "\n",
  );
  fs.writeFileSync(path.join(dir, "source.txt"), t.source + "\n");
}

console.log("wrote", tasks.length, "tasks for base-pa");
