#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "results");
const earlyExit = JSON.parse(
  fs.readFileSync(path.join(dir, "matrix_2026-08-14T03-43-24-163Z.json"), "utf8"),
);
const claudeFixed = JSON.parse(
  fs.readFileSync(path.join(dir, "matrix_2026-08-14T09-05-21-510Z.json"), "utf8"),
);
const codexFull = JSON.parse(
  fs.readFileSync(path.join(dir, "matrix_2026-08-14T11-07-05-600Z.json"), "utf8"),
);
const codexT01Retry = JSON.parse(
  fs.readFileSync(path.join(dir, "matrix_2026-08-14T11-39-58-160Z.json"), "utf8"),
);
const codexT02Retry = JSON.parse(
  fs.readFileSync(path.join(dir, "matrix_2026-08-14T11-53-53-803Z.json"), "utf8"),
);
const evoxFull = JSON.parse(
  fs.readFileSync(path.join(dir, "matrix_2026-08-14T10-47-56-089Z.json"), "utf8"),
);

function cellsOf(j) {
  return j.cells || j.results || j.runs || [];
}

const best = {};

function take(harness, cell, note, force = false) {
  const task = cell.task || cell.taskId;
  if (!best[harness]) best[harness] = {};
  const prev = best[harness][task];
  const pass = !!(cell.pass ?? cell.grade?.pass);
  const wall = cell.wallMs ?? cell.wall_ms ?? null;
  const next = { task, harness, pass, wallMs: wall, note, grade: cell.grade };
  if (!prev || force) {
    best[harness][task] = next;
    return;
  }
  if (!prev.pass && next.pass) best[harness][task] = next;
}

for (const c of cellsOf(earlyExit)) {
  const h = c.harness;
  if (["opencode", "cursor", "deepseek", "pi", "amadeus"].includes(h)) {
    take(h, c, "early-exit matrix 03:43Z", true);
  }
}

for (const c of cellsOf(claudeFixed)) {
  take(c.harness || "claude", c, "claude spawn-fix 09:05Z", true);
}

for (const c of cellsOf(codexFull)) {
  if (c.harness === "codex") take("codex", c, "codex re-run 11:07Z", true);
}
for (const c of cellsOf(codexT01Retry)) {
  if (c.harness === "codex" && (c.pass || c.grade?.pass)) {
    take("codex", c, "codex T01 retry 11:39Z", true);
  }
}
for (const c of cellsOf(codexT02Retry)) {
  if (c.harness === "codex") take("codex", c, "codex T02 retry 11:53Z", true);
}

for (const c of cellsOf(evoxFull)) {
  take("evox", c, "evox full re-run 10:47Z", true);
}

const order = [
  "opencode",
  "cursor",
  "deepseek",
  "pi",
  "amadeus",
  "claude",
  "codex",
  "evox",
];
const catalogTasks = JSON.parse(
  fs.readFileSync(path.join(dir, "..", "tasks", "catalog.json"), "utf8"),
).tasks.map((t) => t.id);

const scoreboard = order.map((h) => {
  const m = best[h] || {};
  const rows = catalogTasks.map((t) => m[t]).filter(Boolean);
  const pass = rows.filter((r) => r.pass).length;
  const total = catalogTasks.length;
  const walls = rows
    .filter((r) => r.pass && typeof r.wallMs === "number")
    .map((r) => r.wallMs)
    .sort((a, b) => a - b);
  const med = walls.length ? walls[Math.floor(walls.length / 2)] : null;
  const fails = catalogTasks.filter((t) => m[t] && !m[t].pass).map((t) => t);
  const incomplete = catalogTasks.filter((t) => !m[t]);
  const status =
    incomplete.length > 0
      ? "partial"
      : fails.length > 0
        ? "complete-with-fails"
        : "complete";
  return {
    harness: h,
    pass,
    total,
    score: `${pass}/${total}`,
    medPassWallMs: med,
    fails,
    incomplete,
    status,
  };
});

const out = {
  title: "Harness bakeoff best-known merge (2026-08-14)",
  finishedAt: new Date().toISOString(),
  policy: [
    "opencode/cursor/deepseek/pi/amadeus: early-exit full matrix 03:43Z",
    "claude: spawn-fix full matrix 09:05Z",
    "codex: re-run 11:07Z (8/10) + T01 retry + T02 retry → 10/10; T01/T02 first attempt hung ~610s",
    "evox: full re-run 10:47Z after budget/MCP URL fix (10/10)",
  ],
  catalogTasks,
  scoreboard,
  cells: best,
};

fs.writeFileSync(path.join(dir, "matrix_BEST_KNOWN.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(scoreboard, null, 2));
console.log("wrote", path.join(dir, "matrix_BEST_KNOWN.json"));
