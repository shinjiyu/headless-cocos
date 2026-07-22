/**
 * Prompt iteration KB — learn from real agent logs to make Cursor faster.
 *
 * Loop:
 *   run → mine transcript (which files Read/Write) → update kb.json →
 *   next prompt injects "hot files / hints" → fewer Glob/explore rounds.
 */

import fs from "node:fs";
import path from "node:path";

const DEFAULT_KB = {
  version: 1,
  goal: "minimize_cursor_wall_ms",
  updatedAt: null,
  hotReads: {},
  hotWrites: {},
  promptHints: [
    "Prefer editing assets/scripts/HeadlessProbe.ts for demo UI / gameplay probes.",
    "Do not Glob **/* or Grep the whole repo unless the hot-file list is insufficient.",
    "Do not sleep/wait for packer — preview HMR is automatic after save.",
  ],
  avoidTools: ["broad Glob **/*", "repo-wide Grep", "sleep waiting for preview"],
  stats: { runs: 0, sdkRuns: 0, avgMs: null, lastMs: null },
};

export function kbDir(projectRoot) {
  return path.join(projectRoot, ".ai-workspace", "prompt-iter");
}

export function kbPath(projectRoot) {
  return path.join(kbDir(projectRoot), "kb.json");
}

export function runsPath(projectRoot) {
  return path.join(kbDir(projectRoot), "runs.jsonl");
}

function ensureDir(projectRoot) {
  fs.mkdirSync(kbDir(projectRoot), { recursive: true });
}

export function loadKb(projectRoot) {
  ensureDir(projectRoot);
  const p = kbPath(projectRoot);
  if (!fs.existsSync(p)) {
    const kb = { ...DEFAULT_KB, promptHints: [...DEFAULT_KB.promptHints], avoidTools: [...DEFAULT_KB.avoidTools] };
    saveKb(projectRoot, kb);
    return kb;
  }
  try {
    return { ...DEFAULT_KB, ...JSON.parse(fs.readFileSync(p, "utf8")) };
  } catch {
    return { ...DEFAULT_KB };
  }
}

export function saveKb(projectRoot, kb) {
  ensureDir(projectRoot);
  kb.updatedAt = new Date().toISOString();
  fs.writeFileSync(kbPath(projectRoot), JSON.stringify(kb, null, 2), "utf8");
}

function bump(map, key, extra = {}) {
  if (!key) return;
  const cur = map[key] || { count: 0 };
  map[key] = {
    ...cur,
    count: (cur.count || 0) + 1,
    lastAt: new Date().toISOString(),
    ...extra,
  };
}

/** Rank hot files by read count, return relative paths. */
export function topHotFiles(kb, limit = 8) {
  return Object.entries(kb.hotReads || {})
    .sort((a, b) => (b[1].count || 0) - (a[1].count || 0))
    .slice(0, limit)
    .map(([rel, meta]) => ({ rel, count: meta.count || 0 }));
}

/**
 * Build the full agent prompt: contract + KB memory + user request.
 */
export function buildPrompt(userText, kb) {
  const hot = topHotFiles(kb, 8);
  const hints = (kb.promptHints || []).slice(0, 12);
  const avoid = (kb.avoidTools || []).slice(0, 8);

  const memoryLines = [];
  memoryLines.push("## Project memory (from past agent runs — use this to go FAST)");
  memoryLines.push("Goal: finish with minimal exploration. Prefer the hot files below; avoid broad search.");
  memoryLines.push(
    "Do NOT read .ai-workspace/, agent-transcripts, packer chunks, or skills to decode the user request — trust the User request section.",
  );
  if (hot.length) {
    memoryLines.push("Hot files (Read these first if relevant; do not Glob **/*):");
    for (const h of hot) memoryLines.push(`- ${h.rel} (read×${h.count})`);
  } else {
    memoryLines.push("Hot files: (empty — first runs will populate from your Reads)");
  }
  if (hints.length) {
    memoryLines.push("Hints:");
    for (const h of hints) memoryLines.push(`- ${h}`);
  }
  if (avoid.length) {
    memoryLines.push("Avoid:");
    for (const a of avoid) memoryLines.push(`- ${a}`);
  }

  const { NO_MCP_CONTRACT } = requireContract();
  return `${NO_MCP_CONTRACT}\n\n${memoryLines.join("\n")}\n\n---\nUser request:\n${String(userText || "").trim()}\n`;
}

function requireContract() {
  // local import kept sync-friendly
  return {
    NO_MCP_CONTRACT: `You are editing a Cocos Creator 3.8 project in a HEADLESS preview environment.

CRITICAL — there is NO Cocos Creator IDE and NO MCP:
- Do NOT call or assume cocosmcp / cocos-meta-mcp / Creator Editor.Message APIs.
- Do NOT try to "refresh preview", "reload terminal", or open Creator.
- Preview updates AUTOMATICALLY when you save files under assets/ (disk watch + mini-packer + HMR).

What you SHOULD do:
- Edit TypeScript under assets/scripts/ (preferred for this demo).
- You may edit .scene / .prefab JSON under assets/ if needed (same-format copy sync).
- Keep changes minimal and finish when the file is saved.

What you MUST NOT do:
- Install MCP servers, invent Creator bridge URLs, or wait for an IDE.
- Edit files outside the project cwd.
`,
  };
}

/**
 * Apply one run's mined tools into the KB + append runs.jsonl.
 */
export function ingestRun(projectRoot, run) {
  const kb = loadKb(projectRoot);
  const reads = run.reads || [];
  const writes = run.writes || [];
  const ms = Number(run.ms) || 0;

  for (const rel of reads) bump(kb.hotReads, rel, { lastMs: ms });
  for (const rel of writes) bump(kb.hotWrites, rel, { lastMs: ms });

  // Auto-hint: dominant write target
  if (writes[0]) {
    const hint = `Primary deliverable path seen in logs: ${writes[0]}`;
    if (!kb.promptHints.includes(hint)) {
      kb.promptHints = [hint, ...kb.promptHints].slice(0, 20);
    }
  }

  // If agent did broad explore, reinforce avoid
  const tools = run.tools || [];
  const broad = tools.some(
    (t) =>
      (t.name === "Glob" && String(t.arg || "").includes("**/*")) ||
      (t.name === "Grep" && String(t.arg || "") === "/workspace"),
  );
  if (broad) {
    const hint = "Past runs wasted time on Glob **/* / repo Grep — skip those when hot files exist.";
    if (!kb.promptHints.includes(hint)) kb.promptHints.push(hint);
  }

  kb.stats = kb.stats || {};
  kb.stats.runs = (kb.stats.runs || 0) + 1;
  if (run.backend === "sdk") kb.stats.sdkRuns = (kb.stats.sdkRuns || 0) + 1;
  kb.stats.lastMs = ms || kb.stats.lastMs;
  if (ms > 0) {
    const n = kb.stats.sdkRuns || 1;
    const prev = kb.stats.avgMs;
    kb.stats.avgMs = prev == null ? ms : Math.round(prev + (ms - prev) / n);
  }

  saveKb(projectRoot, kb);

  ensureDir(projectRoot);
  fs.appendFileSync(
    runsPath(projectRoot),
    JSON.stringify({
      at: new Date().toISOString(),
      ...run,
    }) + "\n",
    "utf8",
  );

  return kb;
}

export function listRecentRuns(projectRoot, limit = 20) {
  const p = runsPath(projectRoot);
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, "utf8").trim().split(/\n/).filter(Boolean);
  return lines
    .slice(-limit)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .reverse();
}
