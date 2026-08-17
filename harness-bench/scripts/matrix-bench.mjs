#!/usr/bin/env node
/**
 * Full harness × task matrix against Docker headless workspace.
 *
 * Host agents edit harness-bench/docker-workspace (bind-mounted into
 * cocos-preview-harness). Preview = Docker mini-packer only — no Creator IDE.
 *
 *   node scripts/matrix-bench.mjs
 *   node scripts/matrix-bench.mjs --harnesses stub,pi,amadeus --tasks T02,T04
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.resolve(__dirname, "..");
const REPO = path.resolve(BENCH, "..");
const COMPOSE = path.join(REPO, "docker/docker-compose.harness-bench.yml");
const WS = path.join(BENCH, "docker-workspace");
const RUN = path.join(BENCH, "run.mjs");

const ALL_HARNESSES = [
  "stub",
  "pi",
  "opencode",
  "amadeus",
  "claude",
  "codex",
  "cursor",
  "deepseek",
  "evox",
  "workbuddy",
];

function parseArgs(argv) {
  const out = { harnesses: ALL_HARNESSES.slice(), tasks: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--harnesses") out.harnesses = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--tasks") out.tasks = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
  }
  return out;
}

function sh(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    cwd: opts.cwd || BENCH,
    encoding: "utf8",
    shell: Boolean(opts.shell),
    env: { ...process.env, ...(opts.env || {}) },
    stdio: opts.inherit ? "inherit" : "pipe",
  });
}

function ensurePreview() {
  fs.mkdirSync(WS, { recursive: true });
  sh("docker", ["compose", "-f", COMPOSE, "up", "-d", "cocos-preview-harness"], {
    cwd: REPO,
    inherit: true,
  });
  for (let i = 0; i < 40; i++) {
    const r = sh("docker", [
      "inspect",
      "--format",
      "{{.State.Health.Status}}",
      "cocos-preview-harness",
    ]);
    const st = (r.stdout || "").trim();
    process.stdout.write(`preview health: ${st || "?"}\n`);
    if (st === "healthy") return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
  }
  return false;
}

const args = parseArgs(process.argv);
const catalog = JSON.parse(fs.readFileSync(path.join(BENCH, "tasks/catalog.json"), "utf8"));
const tasks = args.tasks || catalog.tasks.map((t) => t.id);

if (!ensurePreview()) {
  console.error("Docker headless preview not healthy");
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.join(BENCH, "results");
fs.mkdirSync(outDir, { recursive: true });
const summaryPath = path.join(outDir, `matrix_${stamp}.json`);
const logPath = path.join(outDir, `matrix_${stamp}.jsonl`);

const summary = {
  startedAt: new Date().toISOString(),
  preview: "http://127.0.0.1:7471/",
  workspace: WS,
  harnesses: args.harnesses,
  tasks,
  cells: [],
};

process.env.AMADEUS_MAX_TICKS = process.env.AMADEUS_MAX_TICKS || "50";
process.env.HARNESS_HEADLESS = "1";
process.env.HARNESS_FORBID_IDE = "1";
process.env.HARNESS_FORBID_MCP = "1";

for (const harness of args.harnesses) {
  for (const task of tasks) {
    const t0 = Date.now();
    process.stdout.write(`\n===== ${harness} × ${task} =====\n`);
    const r = sh(
      process.execPath,
      [RUN, "--task", task, "--harness", harness, "--inplace", WS],
      { inherit: true },
    );
    const wallMs = Date.now() - t0;
    const cell = {
      harness,
      task,
      exit: r.status ?? 1,
      pass: (r.status ?? 1) === 0,
      wallMs,
      at: new Date().toISOString(),
    };
    summary.cells.push(cell);
    fs.appendFileSync(logPath, JSON.stringify(cell) + "\n");
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    process.stdout.write(
      `→ ${cell.pass ? "PASS" : "FAIL"} exit=${cell.exit} wallMs=${wallMs}\n`,
    );
  }
}

// Headless proof after matrix
const prove = sh(process.execPath, [path.join(BENCH, "scripts/prove-headless.mjs"), "--since", "6h"], {
  inherit: false,
});
let proveJson = null;
try {
  proveJson = JSON.parse(prove.stdout || "{}");
} catch {
  proveJson = { pass: false, raw: (prove.stdout || prove.stderr || "").slice(0, 2000) };
}
summary.proveHeadless = proveJson;
summary.finishedAt = new Date().toISOString();

const byHarness = {};
for (const c of summary.cells) {
  if (!byHarness[c.harness]) byHarness[c.harness] = { pass: 0, fail: 0, total: 0 };
  byHarness[c.harness].total++;
  if (c.pass) byHarness[c.harness].pass++;
  else byHarness[c.harness].fail++;
}
summary.byHarness = byHarness;
summary.passed = summary.cells.filter((c) => c.pass).length;
summary.failed = summary.cells.filter((c) => !c.pass).length;
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

console.log("\n===== MATRIX SUMMARY =====");
console.log(JSON.stringify({ summaryPath, byHarness, passed: summary.passed, failed: summary.failed, prove: proveJson.pass }, null, 2));
process.exit(summary.failed ? 1 : 0);
