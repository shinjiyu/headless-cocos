# Harness bench — AIWS 真 PA 基础工程

对比不同 coding harness 在 **同一真实 playable-ad 工程**上的表现。

- **基础工程**：`templates/base-pa`（从 AIWS `smoke/demo/pa` 拷贝，~17MB，已 SEED）
- 合同：`AGENTS.contract.md`
- SEED 说明：`templates/base-pa/HARNESS_SEED.md`
- 语料：`corpus/FROM_AIWS.md`
- 浏览：`cases.html`

旧 HeadlessProbe 题：`tasks/_legacy-headless-probe/`  
薄桩 `templates/pa-mini` 仅作对照，**默认不用**。

## 重新种 bug / 重建任务

```powershell
cd d:\tempWorkspace\headless-cocos-research\harness-bench
# 若改坏了 base-pa，可从 AIWS 再拷一份后：
node scripts/seed-base-pa.mjs
node scripts/gen-aiws-tasks.mjs
```

## 任务列表（v3 · 真工程 + SEED）

| ID | 难度 | 改什么 |
|----|------|--------|
| T01-cta-mask-width | easy | CTA.prefab Mask 宽度 |
| T02-cta-sfx-legend-win | easy | CTA 开场 legend_win |
| T03-symbol-vanish-sfx | easy | BoardAudioBinder 消除音 |
| T04-remove-debug-click-gate | medium | 第二段前调试点击 |
| T05-score-font-system-off | medium | 关掉系统字 |
| T06-score-on-symbol-win | medium | 出分事件 symbol-win |
| T07-thunder-sfx-earlier | medium | 雷击音提前 |
| T08-cta-btn-align-start | medium | CTA btn 对齐 MainUI Btn |
| T09-mainui-mask-width | hard | MainUI Mask 加宽 |
| T10-turn-off-debug-hud | hard | FORCE_DEBUG_HUD off |

## Docker 无头（禁止 Creator IDE）

```powershell
cd d:\tempWorkspace\headless-cocos-research
# 起预览 + 在容器里跑 stub（改的是挂载卷 docker-workspace）
node harness-bench/scripts/docker-bench.mjs --task T02-cta-sfx-legend-win --harness stub
# 全量 stub
node harness-bench/scripts/docker-bench.mjs --all --harness stub
```

预览口：http://127.0.0.1:7471/  
验收无 IDE：`node harness-bench/scripts/prove-headless.mjs`

## Harnesses

已接入：`stub` `pi` `opencode` `amadeus` `claude` `codex` `cursor` **`deepseek`** **`evox`** **`workbuddy`**

### 计时口径

默认 **grade 早退**：文件改对且 grade 稳定后杀掉 agent 进程树，避免 Cursor/Pi/Amadeus「做完不退出」把 `wallMs` 顶到 600s。  
关：`HARNESS_GRADE_EARLY_EXIT=0`；轮询/稳定窗：`HARNESS_GRADE_POLL_MS` / `HARNESS_GRADE_SETTLE_MS`。

| id | CLI | 前置 |
|----|-----|------|
| deepseek (`dsh`) | `dsh --profile headless`；默认模型 **PocketCity `GLM-5.2-FP8`**（`~/.dsh/profiles/headless/cordis.patch.yml`） | `OPENAI_API_KEY`（`harness-bench/.env.glm` 已自动加载）；建议 `DSH_PERMISSION_MODE=danger-full-access` |
| workbuddy (`codebuddy`/`cbc`) | `codebuddy -p … -y`（`@tencent-ai/codebuddy-code`） | 先 `codebuddy` 交互 `/login`（桌面 WorkBuddy 登录不自动给 CLI） |
| evox | 默认走桌面 MCP `create_session(surface=code)`（`scripts/evox-complete.mjs`） | 1) 启动 `EvoX.exe` 2) **`EVOX_TOOL_APPROVAL=auto`**（User 环境变量；MCP 会话无审批 UI，否则 edit/bash 会被拒）3) App 内配好可用 provider |

EvoX 可选：`EVOX_MODE=evolver` 走 `@evomap/evolver cycle`（多数 runner 目前 fail-closed，一般不用）。


全矩阵（含新三项）：

```powershell
cd d:\tempWorkspace\headless-cocos-research\harness-bench
node scripts/matrix-bench.mjs --harnesses deepseek,evox,workbuddy
```

