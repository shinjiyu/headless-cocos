#!/usr/bin/env node
/**
 * Prepare a fresh workdir from the Cocos template, then (optionally) invoke a harness.
 *
 * Usage:
 *   node run.mjs --task T01-bump-probe --harness stub
 *   node run.mjs --task T01-bump-probe --harness claude
 *   node run.mjs --task T01-bump-probe --harness opencode
 *   node run.mjs --task T01-bump-probe --harness cursor
 *   node run.mjs --list
 *
 * Env:
 *   TEMPLATE_PROJECT  default d:/tempWorkspace/baseAIAutoCocos
 *   WORK_ROOT         default harness-bench/work
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn, spawnSync } from "child_process";
import { grade } from "./grader/grade.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Load harness-bench/.env.glm (from D:\\kuroneko) into process.env if present. */
function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const raw of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env) || !process.env[key]) process.env[key] = val;
  }
}
loadDotEnv(path.join(__dirname, ".env.glm"));
loadDotEnv(path.join(__dirname, ".env.deepseek"));
loadDotEnv(path.join(__dirname, ".env.workbuddy"));

const TEMPLATE =
  process.env.TEMPLATE_PROJECT ||
  path.join(__dirname, "templates/base-pa");
const WORK_ROOT = process.env.WORK_ROOT || path.join(__dirname, "work");
const CONTRACT = fs.readFileSync(path.join(__dirname, "AGENTS.contract.md"), "utf8");
const GLM_MODEL = process.env.OPENAI_MODEL || "GLM-5.2-FP8";
const AGENT_TIMEOUT_MS = Number(process.env.HARNESS_TIMEOUT_MS || 600000);
/** Poll grade while agent runs; kill process tree once pass is stable.
 *  Fixes Cursor/Pi/Amadeus "done but never exit" inflating wallMs to 600s. */
const GRADE_EARLY_EXIT = process.env.HARNESS_GRADE_EARLY_EXIT !== "0";
const GRADE_POLL_MS = Number(process.env.HARNESS_GRADE_POLL_MS || 2000);
const GRADE_SETTLE_MS = Number(process.env.HARNESS_GRADE_SETTLE_MS || 2500);

/** Shared one-liner so Windows argv stays short; full contract is on disk. */
function shortPointer() {
  return "Read .harness-prompt.txt and AGENTS.md, then complete the task with minimal edits under assets/. Preserve .meta UUIDs. No Cocos Creator IDE / MCP.";
}

function spawnResult(r) {
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: (r.stdout || "").slice(0, 8000),
    stderr: (r.stderr || "").slice(0, 4000),
  };
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Spawn agent and stop the clock when the task grade stays green.
 * wallMs ≈ time-to-correct (plus settle), not "process refused to exit".
 */
function spawnWithGradeWatch({
  command,
  args,
  options = {},
  taskDir,
  workdir,
  timeoutMs = AGENT_TIMEOUT_MS,
  input = null,
}) {
  const t0 = Date.now();
  let stdout = "";
  let stderr = "";
  const child = spawn(command, args, {
    ...options,
    stdio: input != null ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
  });
  if (input != null) {
    try {
      child.stdin.write(input);
      child.stdin.end();
    } catch {
      /* ignore broken pipe if child died immediately */
    }
  }
  child.stdout?.on("data", (d) => {
    stdout += d.toString();
    if (stdout.length > 200000) stdout = stdout.slice(-120000);
  });
  child.stderr?.on("data", (d) => {
    stderr += d.toString();
    if (stderr.length > 120000) stderr = stderr.slice(-80000);
  });

  let exited = false;
  let exitCode = null;
  let exitSignal = null;
  child.on("exit", (code, signal) => {
    exited = true;
    exitCode = code;
    exitSignal = signal;
  });
  child.on("error", (err) => {
    exited = true;
    exitCode = 1;
    stderr += `\n${err}\n`;
  });

  let stableSince = null;
  let earlyExit = false;
  let gradePassAtMs = null;

  while (!exited && Date.now() - t0 < timeoutMs) {
    sleepMs(GRADE_POLL_MS);
    if (!GRADE_EARLY_EXIT || !taskDir) continue;
    try {
      const report = grade(taskDir, workdir);
      if (report.pass) {
        if (gradePassAtMs == null) gradePassAtMs = Date.now() - t0;
        if (stableSince == null) stableSince = Date.now();
        if (Date.now() - stableSince >= GRADE_SETTLE_MS) {
          earlyExit = true;
          killProcessTree(child.pid);
          const deadline = Date.now() + 8000;
          while (!exited && Date.now() < deadline) sleepMs(100);
          break;
        }
      } else {
        stableSince = null;
      }
    } catch {
      /* ignore transient grade errors */
    }
  }

  if (!exited) {
    killProcessTree(child.pid);
    const deadline = Date.now() + 8000;
    while (!exited && Date.now() < deadline) sleepMs(100);
  }

  const wallMs = Date.now() - t0;
  return {
    ok: earlyExit || exitCode === 0,
    status: earlyExit ? 0 : exitCode,
    stdout: stdout.slice(0, 8000),
    stderr: stderr.slice(0, 4000),
    earlyExit,
    gradePassAtMs,
    timedOut: !earlyExit && wallMs >= timeoutMs - GRADE_POLL_MS,
    signal: exitSignal,
    watchWallMs: wallMs,
  };
}

function parseArgs(argv) {
  const out = { task: null, harness: "stub", list: false, inplace: null, all: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--list") out.list = true;
    else if (a === "--all") out.all = true;
    else if (a === "--task") out.task = argv[++i];
    else if (a === "--harness") out.harness = argv[++i];
    else if (a === "--inplace") out.inplace = argv[++i];
  }
  return out;
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (name === "library" || name === "temp" || name === "node_modules" || name === ".git") continue;
    const s = path.join(src, name);
    const d = path.join(dest, name);
    const st = fs.statSync(s);
    if (st.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function buildPrompt(taskDir) {
  const body = fs.readFileSync(path.join(taskDir, "prompt.md"), "utf8");
  return `${CONTRACT}\n\n---\n\n${body}`;
}

function runStub(workdir, prompt) {
  const notes = [];
  const ctaView = path.join(workdir, "assets/scripts/_genbot/CTA/CTA.view.ts");
  const mainView = path.join(workdir, "assets/scripts/_genbot/MainUI/MainUI.view.ts");
  const binder = path.join(workdir, "assets/scripts/audio/BoardAudioBinder.ts");
  const ctaPrefab = path.join(workdir, "assets/resources/prefab/CTA.prefab");
  const mainPrefab = path.join(workdir, "assets/resources/prefab/MainUI.prefab");

  if (fs.existsSync(ctaView) && /legend_win|T02/i.test(prompt)) {
    let t = fs.readFileSync(ctaView, "utf8");
    t = t.replace(/Sfx\.play\(\s*["']bigwin["']\s*\)/, 'Sfx.play("legend_win")');
    fs.writeFileSync(ctaView, t);
    notes.push("T02 legend_win");
  }
  if (fs.existsSync(binder) && /symbol-vanish|T03/i.test(prompt)) {
    let t = fs.readFileSync(binder, "utf8");
    if (!/["']symbol-vanish["']\s*:/.test(t)) {
      t = t.replace(
        /const CELL_SFX[^=]*=\s*\{/,
        'const CELL_SFX: Partial<Record<BoardEvent["type"], string>> = {\n    "symbol-vanish": "symbol_vanish",',
      );
      // if type annotation already there, simpler insert after {
      if (!/["']symbol-vanish["']\s*:/.test(t)) {
        t = t.replace(/CELL_SFX[^=]*=\s*\{/, (m) => `${m}\n    "symbol-vanish": "symbol_vanish",`);
      }
      fs.writeFileSync(binder, t);
      notes.push("T03 symbol-vanish");
    }
  }
  if (fs.existsSync(mainView)) {
    let t = fs.readFileSync(mainView, "utf8");
    let changed = false;
    if (/WAIT_CLICK|T04/i.test(prompt) && /WAIT_CLICK_BEFORE_SECOND\s*=\s*true/.test(t)) {
      t = t.replace(/WAIT_CLICK_BEFORE_SECOND\s*=\s*true/, "WAIT_CLICK_BEFORE_SECOND = false");
      changed = true;
      notes.push("T04 gate");
    }
    if (/SCORE_USE_SYSTEM_FONT|T05|系统字/i.test(prompt) && /SCORE_USE_SYSTEM_FONT\s*=\s*true/.test(t)) {
      t = t.replace(/SCORE_USE_SYSTEM_FONT\s*=\s*true/, "SCORE_USE_SYSTEM_FONT = false");
      changed = true;
      notes.push("T05 font");
    }
    if (/symbol-win|T06/i.test(prompt) && /events\.on\(\s*["']symbol-vanish["']/.test(t)) {
      t = t.replace(
        /events\.on\(\s*["']symbol-vanish["'][^,]*/,
        'events.on("symbol-win"',
      );
      changed = true;
      notes.push("T06 symbol-win");
    }
    if (/THUNDER_SFX_DELAY|T07|雷击|闪电/i.test(prompt) && /THUNDER_SFX_DELAY\s*=\s*0\.85/.test(t)) {
      t = t.replace(/THUNDER_SFX_DELAY\s*=\s*0\.85/, "THUNDER_SFX_DELAY = 0.4");
      changed = true;
      notes.push("T07 thunder");
    }
    if (/FORCE_DEBUG_HUD|T10|调试 HUD/i.test(prompt) && /FORCE_DEBUG_HUD\s*=\s*true/.test(t)) {
      t = t.replace(/FORCE_DEBUG_HUD\s*=\s*true/, "FORCE_DEBUG_HUD = false");
      changed = true;
      notes.push("T10 hud");
    }
    if (changed) fs.writeFileSync(mainView, t);
  }
  if (fs.existsSync(ctaPrefab) && (/Mask|T01|T08|btn/i.test(prompt))) {
    const arr = JSON.parse(fs.readFileSync(ctaPrefab, "utf8"));
    let changed = false;
    if (/T01|Mask 过窄|width/i.test(prompt) && arr[29]?.__type__ === "cc.UITransform") {
      arr[29]._contentSize.width = 720;
      changed = true;
      notes.push("T01 mask720");
    }
    if (/T08|对齐|btn\.y|-524/i.test(prompt) && arr[38]?._name === "btn") {
      arr[38]._lpos.y = -524.8;
      changed = true;
      notes.push("T08 btn y");
    }
    if (changed) fs.writeFileSync(ctaPrefab, JSON.stringify(arr, null, 2) + "\n");
  }
  if (fs.existsSync(mainPrefab) && /T09|MainUI Mask|加宽/i.test(prompt)) {
    const arr = JSON.parse(fs.readFileSync(mainPrefab, "utf8"));
    if (arr[175]?.__type__ === "cc.UITransform") {
      arr[175]._contentSize.width = 720;
      fs.writeFileSync(mainPrefab, JSON.stringify(arr, null, 2) + "\n");
      notes.push("T09 main mask720");
    }
  }
  return { ok: true, note: notes.length ? `stub: ${notes.join(", ")}` : "stub no-op" };
}

function resolveClaudeBin() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  if (process.platform === "win32") {
    const exe = path.join(
      process.env.APPDATA || "",
      "npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe",
    );
    if (fs.existsSync(exe)) return exe;
  }
  return "claude";
}

function runClaude(workdir, prompt, taskDir) {
  const promptFile = path.join(workdir, ".harness-prompt.txt");
  fs.writeFileSync(promptFile, prompt, "utf8");
  // Task lives on disk. Pass a short -p pointer as a real argv element.
  // On Windows: call claude.exe with shell:false so spaces are NOT split by cmd
  // (shell:true previously reduced the prompt to the single token "You").
  const pointer =
    "You MUST edit files now. Read .harness-prompt.txt and AGENTS.md, then apply the required code/prefab changes under assets/. Do not only acknowledge. Stop when done.";
  const bin = resolveClaudeBin();
  const useShell = process.platform === "win32" && bin === "claude";
  return spawnWithGradeWatch({
    command: bin,
    args: [
      "-p",
      pointer,
      "--output-format",
      "json",
      "--permission-mode",
      "acceptEdits",
    ],
    options: { cwd: workdir, shell: useShell, env: process.env },
    taskDir,
    workdir,
  });
}

function runOpencode(workdir, prompt, taskDir) {
  const promptFile = path.join(workdir, ".harness-prompt.txt");
  fs.writeFileSync(promptFile, prompt, "utf8");
  const bin =
    process.env.OPENCODE_BIN ||
    (process.platform === "win32"
      ? path.join(
          process.env.APPDATA || "",
          "npm/node_modules/opencode-ai/bin/opencode.exe",
        )
      : "opencode");
  return spawnWithGradeWatch({
    command: bin,
    args: [
      "run",
      "-m",
      `pocketcity/${GLM_MODEL}`,
      "--dir",
      workdir,
      `Open .harness-prompt.txt and AGENTS.md in this project, then complete the described task with minimal edits under assets/. Preserve .meta UUIDs.`,
    ],
    options: { cwd: workdir, shell: false, env: process.env },
    taskDir,
    workdir,
  });
}

function loadCursorKeyFromAiws() {
  if (process.env.CURSOR_API_KEY) return;
  const cfg = "D:/workspace/ae_meta_mcp/ai-game-workspace/config.local.json";
  try {
    if (!fs.existsSync(cfg)) return;
    const j = JSON.parse(fs.readFileSync(cfg, "utf8"));
    const k = j?.secrets?.cursorApiKey;
    if (typeof k === "string" && k) process.env.CURSOR_API_KEY = k;
  } catch {
    /* ignore */
  }
}

function runCursor(workdir, prompt, taskDir) {
  loadCursorKeyFromAiws();
  const promptFile = path.join(workdir, ".harness-prompt.txt");
  fs.writeFileSync(promptFile, prompt, "utf8");
  return spawnWithGradeWatch({
    command: "agent",
    args: [
      "-p",
      `Read .harness-prompt.txt and AGENTS.md, then complete the task. Edit assets/ only; no MCP/IDE. When done, stop.`,
      "--trust",
      "--force",
      "--workspace",
      workdir,
    ],
    options: { cwd: workdir, shell: true, env: process.env },
    taskDir,
    workdir,
  });
}

function runPi(workdir, prompt, taskDir) {
  const promptFile = path.join(workdir, ".harness-prompt.txt");
  fs.writeFileSync(promptFile, prompt, "utf8");
  return spawnWithGradeWatch({
    command: "pi",
    args: [
      "-p",
      "--provider",
      "pocketcity",
      "--model",
      GLM_MODEL,
      `Read ${promptFile} and AGENTS.md, then complete the task with minimal diffs under assets/. Stop when done.`,
    ],
    options: { cwd: workdir, shell: true, env: process.env },
    taskDir,
    workdir,
  });
}

function resolveCodexBin() {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
  if (process.platform === "win32") {
    const exe = path.join(
      process.env.APPDATA || "",
      "npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe",
    );
    if (fs.existsSync(exe)) return exe;
  }
  return "codex";
}

function runCodex(workdir, prompt, taskDir) {
  const promptFile = path.join(workdir, ".harness-prompt.txt");
  fs.writeFileSync(promptFile, prompt, "utf8");
  // Same Windows pitfall as Claude: shell:true + spaced argv/stdin via cmd is flaky.
  // Call codex.exe directly; pass a short pointer as the prompt arg (task on disk).
  const pointer =
    "Read .harness-prompt.txt and AGENTS.md, then complete the task. Edit assets/ only; preserve .meta UUIDs. Stop when done.";
  const bin = resolveCodexBin();
  const useShell = process.platform === "win32" && bin === "codex";
  return spawnWithGradeWatch({
    command: bin,
    args: [
      "exec",
      "-C",
      workdir,
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      pointer,
    ],
    options: { cwd: workdir, shell: useShell, env: process.env },
    taskDir,
    workdir,
  });
}

function runAmadeus(workdir, prompt, taskDir) {
  const promptFile = path.join(workdir, ".harness-prompt.txt");
  fs.writeFileSync(promptFile, prompt, "utf8");
  const launcher =
    process.env.AMADEUS_BENCH_JS ||
    "d:/kuroneko/scripts/amadeus-bench.mjs";
  // Lower default ticks; grade-early-exit still caps wall when file is correct.
  const maxTicks = process.env.AMADEUS_MAX_TICKS || "50";
  return spawnWithGradeWatch({
    command: process.execPath,
    args: [
      launcher,
      "run",
      "--cwd",
      workdir,
      "--prompt-file",
      promptFile,
      "--max-ticks",
      maxTicks,
      "--json",
    ],
    options: { cwd: workdir, shell: false, env: process.env },
    taskDir,
    workdir,
  });
}

/** DeepSeek Harness (`dsh --profile headless`).
 *  Bakeoff default: PocketCity GLM via ~/.dsh/profiles/headless/cordis.patch.yml
 *  (provider pocketcity / GLM-5.2-FP8). Needs OPENAI_API_KEY from .env.glm. */
function runDeepseek(workdir, prompt, taskDir) {
  if (!process.env.OPENAI_API_KEY && !process.env.DEEPSEEK_API_KEY) {
    return {
      ok: false,
      status: 2,
      stdout: "",
      stderr:
        "OPENAI_API_KEY (PocketCity GLM) or DEEPSEEK_API_KEY missing. Load harness-bench/.env.glm.",
    };
  }
  const promptFile = path.join(workdir, ".harness-prompt.txt");
  fs.writeFileSync(promptFile, prompt, "utf8");
  const bin = process.env.DSH_BIN || "dsh";
  const env = {
    ...process.env,
    // Non-interactive: no approval prompts; allow workspace writes fully.
    DSH_PERMISSION_MODE:
      process.env.DSH_PERMISSION_MODE || "danger-full-access",
  };
  return spawnWithGradeWatch({
    command: bin,
    args: ["--profile", "headless", shortPointer()],
    options: { cwd: workdir, shell: true, env },
    taskDir,
    workdir,
  });
}

/**
 * WorkBuddy / CodeBuddy Code headless CLI.
 * Bin: codebuddy|cbc (npm @tencent-ai/codebuddy-code). Requires `codebuddy` login.
 */
function runWorkbuddy(workdir, prompt, taskDir) {
  const promptFile = path.join(workdir, ".harness-prompt.txt");
  fs.writeFileSync(promptFile, prompt, "utf8");
  const bin = process.env.WORKBUDDY_BIN || process.env.CODEBUDDY_BIN || "codebuddy";
  const env = {
    ...process.env,
    CODEBUDDY_SKIP_GIT_BASH_CHECK: process.env.CODEBUDDY_SKIP_GIT_BASH_CHECK || "1",
  };
  if (process.env.WORKBUDDY_CONFIG_DIR && !env.CODEBUDDY_CONFIG_DIR) {
    env.CODEBUDDY_CONFIG_DIR = process.env.WORKBUDDY_CONFIG_DIR;
  }
  return spawnWithGradeWatch({
    command: bin,
    args: [
      "-p",
      shortPointer(),
      "-y",
      "--permission-mode",
      "bypassPermissions",
      "--output-format",
      "json",
    ],
    options: { cwd: workdir, shell: true, env },
    taskDir,
    workdir,
  });
}

/**
 * EvoX desktop coding agent via MCP create_session(surface=code, cwd).
 * Requires EvoX.exe running with evox-sessions MCP.
 * Fallback: EVOX_MODE=evolver → `evolver cycle`.
 */
function runEvox(workdir, prompt, taskDir) {
  const promptFile = path.join(workdir, ".harness-prompt.txt");
  fs.writeFileSync(promptFile, prompt, "utf8");
  const mode = (process.env.EVOX_MODE || "desktop").toLowerCase();
  if (mode === "evolver") {
    const bin = process.env.EVOX_BIN || "evolver";
    const runner = process.env.EVOX_RUNNER || "claude";
    const timeoutMs = String(process.env.EVOX_TIMEOUT_MS || AGENT_TIMEOUT_MS);
    const effect =
      process.env.EVOX_EXPECTED_EFFECT ||
      "Apply the minimal assets/ fix described in .harness-prompt.txt and AGENTS.md; preserve .meta UUIDs.";
    const r = spawnSync(
      bin,
      [
        "cycle",
        "--repo",
        workdir,
        "--limit",
        process.env.EVOX_LIMIT || "1",
        "--expected-effect",
        effect,
        "--runner",
        runner,
        "--timeout-ms",
        timeoutMs,
        "--json",
      ],
      {
        cwd: workdir,
        encoding: "utf8",
        timeout: Number(timeoutMs) + 60000,
        shell: true,
        env: process.env,
      },
    );
    return spawnResult(r);
  }

  const helper = path.join(__dirname, "scripts/evox-complete.mjs");
  const short = `${shortPointer()}\n\nWorkspace: ${workdir}\nRead .harness-prompt.txt and AGENTS.md, then apply the required assets/ edits now.\n\n---\n${prompt}`;
  fs.writeFileSync(promptFile, short, "utf8");
  const args = [helper, "--cwd", workdir, "--prompt-file", promptFile];
  if (taskDir) args.push("--task-dir", taskDir);
  const r = spawnSync(process.execPath, args, {
    cwd: workdir,
    encoding: "utf8",
    // outer timeout > inner EVOX_TIMEOUT_MS + settle
    timeout: AGENT_TIMEOUT_MS + 120000,
    shell: false,
    env: process.env,
  });
  return spawnResult(r);
}

function emptyDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  // Docker Desktop bind mounts can race ENOTEMPTY — retry + fallback
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      for (const name of fs.readdirSync(dir)) {
        fs.rmSync(path.join(dir, name), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
      if (fs.readdirSync(dir).length === 0) return;
    } catch (e) {
      if (attempt === 4) throw e;
    }
  }
}

function runOne(taskId, harness, inplace) {
  const taskDir = path.join(__dirname, "tasks", taskId);
  if (!fs.existsSync(taskDir)) {
    console.error("Unknown task", taskId);
    return { task: taskId, pass: false, error: "unknown task" };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let workdir;
  if (inplace) {
    workdir = path.resolve(inplace);
    console.log("inplace template →", workdir);
    emptyDir(workdir);
    copyDir(TEMPLATE, workdir);
  } else {
    workdir = path.join(WORK_ROOT, `${harness}_${taskId}_${stamp}`);
    fs.mkdirSync(WORK_ROOT, { recursive: true });
    console.log("template →", workdir);
    copyDir(TEMPLATE, workdir);
  }

  // Docker / headless contract stamp (agents + auditors)
  fs.writeFileSync(
    path.join(workdir, "AGENTS.md"),
    `${CONTRACT}\n\n## Runtime\n\nHeadless Docker preview only. No Cocos Creator IDE. No cocosmcp.\n`,
  );

  const prompt = buildPrompt(taskDir);
  fs.writeFileSync(path.join(workdir, ".harness-prompt.txt"), prompt);

  const t0 = Date.now();
  let harnessResult;
  switch (harness) {
    case "stub":
      harnessResult = runStub(workdir, prompt);
      break;
    case "claude":
      harnessResult = runClaude(workdir, prompt, taskDir);
      break;
    case "opencode":
      harnessResult = runOpencode(workdir, prompt, taskDir);
      break;
    case "cursor":
      harnessResult = runCursor(workdir, prompt, taskDir);
      break;
    case "pi":
      harnessResult = runPi(workdir, prompt, taskDir);
      break;
    case "codex":
      harnessResult = runCodex(workdir, prompt, taskDir);
      break;
    case "amadeus":
      harnessResult = runAmadeus(workdir, prompt, taskDir);
      break;
    case "deepseek":
    case "dsh":
      harnessResult = runDeepseek(workdir, prompt, taskDir);
      break;
    case "workbuddy":
    case "codebuddy":
    case "cbc":
      harnessResult = runWorkbuddy(workdir, prompt, taskDir);
      break;
    case "evox":
    case "evolver":
      harnessResult = runEvox(workdir, prompt, taskDir);
      break;
    default:
      console.error("Unknown harness", harness);
      return { task: taskId, pass: false, error: "unknown harness" };
  }
  const wallMs = Date.now() - t0;

  const report = grade(taskDir, workdir);
  const out = {
    task: taskId,
    harness,
    workdir,
    wallMs,
    harnessResult,
    grade: report,
    runtime: {
      headless: true,
      inplace: Boolean(inplace),
      forbidIde: true,
      forbidMcp: true,
    },
  };
  const resultsDir = path.join(__dirname, "results");
  fs.mkdirSync(resultsDir, { recursive: true });
  const outPath = path.join(resultsDir, `${stamp}_${harness}_${taskId}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ pass: report.pass, wallMs, outPath, grade: report }, null, 2));
  return { ...out, outPath, pass: report.pass };
}

const args = parseArgs(process.argv);
const catalog = JSON.parse(
  fs.readFileSync(path.join(__dirname, "tasks/catalog.json"), "utf8"),
);

if (args.list) {
  for (const t of catalog.tasks) console.log(`${t.id}\t${t.tier}\t${(t.tags || []).join(",")}`);
  process.exit(0);
}

if (args.all) {
  const results = [];
  for (const t of catalog.tasks) {
    try {
      results.push(runOne(t.id, args.harness, args.inplace));
    } catch (e) {
      console.error(`[run] ${t.id} crashed:`, e instanceof Error ? e.message : e);
      results.push({ task: t.id, pass: false, error: String(e) });
    }
  }
  const failed = results.filter((r) => !r.pass);
  console.log(
    JSON.stringify(
      {
        mode: "all",
        harness: args.harness,
        total: results.length,
        passed: results.length - failed.length,
        failed: failed.map((f) => f.task),
      },
      null,
      2,
    ),
  );
  process.exit(failed.length ? 1 : 0);
}

if (!args.task) {
  console.error("Need --task <id> (or --list / --all)");
  process.exit(2);
}

const one = runOne(args.task, args.harness, args.inplace);
process.exit(one.pass ? 0 : 1);
