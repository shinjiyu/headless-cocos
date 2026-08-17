#!/usr/bin/env node
/**
 * Host-side orchestrator: Docker headless preview + in-container harness run.
 *
 *   node scripts/docker-bench.mjs --task T02-cta-sfx-legend-win --harness stub
 *   node scripts/docker-bench.mjs --all --harness stub
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");
const BENCH = path.resolve(__dirname, "..");
const COMPOSE = path.join(REPO, "docker/docker-compose.harness-bench.yml");
const WS = path.join(BENCH, "docker-workspace");

function parseArgs(argv) {
  const out = { task: null, harness: "stub", all: false, upOnly: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") out.all = true;
    else if (a === "--up-only") out.upOnly = true;
    else if (a === "--task") out.task = argv[++i];
    else if (a === "--harness") out.harness = argv[++i];
  }
  return out;
}

function run(cmd, args, opts = {}) {
  console.log("$", cmd, args.join(" "));
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || REPO,
    encoding: "utf8",
    shell: opts.shell || false,
    stdio: "inherit",
    env: process.env,
  });
  if ((r.status ?? 1) !== 0 && !opts.allowFail) {
    process.exit(r.status ?? 1);
  }
  return r.status ?? 1;
}

fs.mkdirSync(WS, { recursive: true });
// placeholder so empty mount is valid for preview boot
if (!fs.existsSync(path.join(WS, "package.json"))) {
  // seed once from template so preview can start before first task wipe
  run(process.execPath, [
    path.join(BENCH, "run.mjs"),
    "--task",
    "T02-cta-sfx-legend-win",
    "--harness",
    "stub",
    "--inplace",
    WS,
  ], { cwd: BENCH, allowFail: true });
}

const args = parseArgs(process.argv);

run("docker", [
  "compose",
  "-f",
  COMPOSE,
  "up",
  "-d",
  "--build",
  "cocos-preview-harness",
]);

// wait healthy
for (let i = 0; i < 40; i++) {
  const r = spawnSync(
    "docker",
    ["inspect", "--format", "{{.State.Health.Status}}", "cocos-preview-harness"],
    { encoding: "utf8" },
  );
  const st = (r.stdout || "").trim();
  console.log("preview health:", st || "(none)");
  if (st === "healthy") break;
  spawnSync(process.execPath, ["-e", "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,2000)"]);
}
if (args.upOnly) {
  console.log("Preview up: http://127.0.0.1:7471/");
  process.exit(0);
}

const nodeArgs = ["run.mjs", "--harness", args.harness, "--inplace", "/workspace"];
if (args.all) nodeArgs.push("--all");
else {
  if (!args.task) {
    console.error("Need --task or --all");
    process.exit(2);
  }
  nodeArgs.push("--task", args.task);
}

const status = run("docker", [
  "compose",
  "-f",
  COMPOSE,
  "run",
  "--rm",
  "--no-deps",
  "harness-runner",
  ...nodeArgs,
]);

// prove headless after edits (give packer a moment)
spawnSync(process.execPath, ["-e", "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,3000)"]);
run(process.execPath, [path.join(BENCH, "scripts/prove-headless.mjs")], {
  cwd: BENCH,
  allowFail: true,
});

process.exit(status);
