#!/usr/bin/env node
/**
 * Headless EvoX coding run via desktop MCP `evox-sessions`:
 *   create_session({ surface:"code", cwd, first_message })
 * then poll grader until pass / timeout.
 *
 * Requires EvoX desktop + gateway with EVOX_TOOL_APPROVAL=auto
 * (MCP/code sessions have no approval UI; without this env, edit/bash/write
 * auto-deny or hang on before_tool_call).
 *
 *   node scripts/evox-complete.mjs --cwd <dir> --prompt-file <file> [--task-dir <task>]
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { grade } from "../grader/grade.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return fallback;
  return process.argv[i + 1] ?? fallback;
}

function parseSSE(text) {
  return text
    .split(/\n/)
    .filter((l) => l.startsWith("data: "))
    .map((l) => JSON.parse(l.slice(6)));
}

const cwd = path.resolve(arg("--cwd", process.cwd()));
const promptFile = arg("--prompt-file");
const promptInline = arg("--prompt");
const taskDir = arg("--task-dir");
const prompt = promptFile
  ? fs.readFileSync(promptFile, "utf8")
  : promptInline;
if (!prompt) {
  console.error("Need --prompt-file or --prompt");
  process.exit(2);
}

const home = process.env.EVOX_HOME || path.join(os.homedir(), ".evox");
const settingsPath = path.join(home, "agent", "settings.json");

function readMcpUrl() {
  if (process.env.EVOX_MCP_URL) return process.env.EVOX_MCP_URL;
  if (!fs.existsSync(settingsPath)) return null;
  try {
    const s = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    return s?.mcpServers?.["evox-sessions"]?.url || null;
  } catch {
    return null;
  }
}

let mcpUrl = readMcpUrl();
if (!mcpUrl) {
  console.error(
    "EvoX MCP URL missing. Start EvoX desktop and ensure evox-sessions MCP is up.",
  );
  process.exit(2);
}
console.log(`mcp_url=${mcpUrl}`);

const headers = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

async function mcp(method, params, id = 1, attempt = 0) {
  const body =
    method === "notifications/initialized"
      ? { jsonrpc: "2.0", method }
      : { jsonrpc: "2.0", id, method, params };
  try {
    const res = await fetch(mcpUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (method.startsWith("notifications/")) return null;
    const frames = parseSSE(text);
    const last = frames[frames.length - 1];
    if (last?.error) throw new Error(JSON.stringify(last.error));
    return last?.result;
  } catch (e) {
    const code = e?.cause?.code || "";
    // EvoX restarts rotate the MCP port; re-read settings and retry once.
    if (
      attempt < 2 &&
      (code === "ECONNREFUSED" || code === "ECONNRESET" || /fetch failed/i.test(String(e)))
    ) {
      const next = readMcpUrl();
      if (next && next !== mcpUrl) {
        console.error(`mcp_url_rotated ${mcpUrl} → ${next}`);
        mcpUrl = next;
      } else {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        const refreshed = readMcpUrl();
        if (refreshed) mcpUrl = refreshed;
      }
      return mcp(method, params, id, attempt + 1);
    }
    throw e;
  }
}

await mcp("initialize", {
  protocolVersion: "2025-03-26",
  capabilities: {},
  clientInfo: { name: "harness-bench", version: "0.1" },
});
await mcp("notifications/initialized");

async function archiveSession(sessionId, label = "archive") {
  if (!sessionId) return;
  try {
    const r = await mcp(
      "tools/call",
      { name: "archive_session", arguments: { session_id: sessionId } },
      Date.now() % 100000,
    );
    const text = r?.content?.[0]?.text || JSON.stringify(r);
    console.log(`${label}=${sessionId} ${String(text).slice(0, 120)}`);
  } catch (e) {
    console.error(
      `${label}_fail=${sessionId} ${e instanceof Error ? e.message : e}`,
    );
  }
}

// Free live budget before create (stale harness code sessions).
try {
  const listed = await mcp("tools/call", { name: "list_sessions", arguments: {} }, 2);
  const sessions = JSON.parse(listed?.content?.[0]?.text || "[]");
  const stale = sessions.filter((s) => {
    const title = String(s.title || "");
    const scwd = String(s.cwd || "");
    return (
      /harness|Read \.harness-prompt|Cocos assets/i.test(title) ||
      /harness-bench|docker-workspace/i.test(scwd)
    );
  });
  if (stale.length) {
    console.log(`preflight_archive_targets=${stale.length}`);
    for (const s of stale) await archiveSession(s.id, "preflight_archive");
  }
} catch (e) {
  console.error(
    `preflight_list_fail ${e instanceof Error ? e.message : e}`,
  );
}

const title = `harness-${Date.now()}`;
const created = await mcp(
  "tools/call",
  {
    name: "create_session",
    arguments: {
      title,
      surface: "code",
      cwd,
      first_message: prompt,
    },
  },
  3,
);
const createdText = created?.content?.[0]?.text || JSON.stringify(created);
console.log(createdText);
if (created?.isError) process.exit(1);
const sidMatch = createdText.match(/session\s+([0-9a-f-]{36})/i);
const sessionId = sidMatch?.[1] || null;
if (sessionId) console.log(`session_id=${sessionId}`);

const timeoutMs = Number(process.env.EVOX_TIMEOUT_MS || 600000);
const pollMs = Number(process.env.EVOX_POLL_MS || 8000);
const settleMs = Number(process.env.EVOX_SETTLE_MS || 15000);
const t0 = Date.now();
let passed = false;
let lastFail = null;
let stableSince = null;

try {
  while (Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, pollMs));
    if (taskDir && fs.existsSync(taskDir)) {
      const report = grade(taskDir, cwd);
      if (report.pass) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= settleMs) {
          passed = true;
          console.log(
            `grade_pass=true elapsed_ms=${Date.now() - t0} settle_ms=${settleMs}`,
          );
          break;
        } else {
          console.log(
            `grade_pass_pending_settle elapsed_ms=${Date.now() - t0}`,
          );
        }
      } else {
        stableSince = null;
        lastFail = report.results?.filter((x) => !x.ok).map((x) => x.message);
        console.log(
          `grade_fail elapsed_ms=${Date.now() - t0} missing=${JSON.stringify(lastFail)}`,
        );
      }
    } else {
      console.log(`waiting elapsed_ms=${Date.now() - t0} (no --task-dir)`);
    }
  }
} finally {
  await archiveSession(sessionId, "post_archive");
}

if (!passed) {
  console.error(
    `EvoX timed out after ${timeoutMs}ms (session=${sessionId}) lastFail=${JSON.stringify(lastFail)}`,
  );
  process.exit(1);
}
console.log("ok");
process.exit(0);
