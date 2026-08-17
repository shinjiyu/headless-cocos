/**
 * Archive EvoX sessions that block create_session ("live session budget exhausted").
 * Usage: node scripts/evox-archive-sessions.mjs [--all] [--cwd-substr docker-workspace]
 */
import fs from "fs";
import os from "os";
import path from "path";

const home = process.env.EVOX_HOME || path.join(os.homedir(), ".evox");
const settings = JSON.parse(
  fs.readFileSync(path.join(home, "agent", "settings.json"), "utf8"),
);
const mcpUrl =
  process.env.EVOX_MCP_URL || settings?.mcpServers?.["evox-sessions"]?.url;
if (!mcpUrl) {
  console.error("EVOX MCP URL missing");
  process.exit(2);
}

const all = process.argv.includes("--all");
const cwdIdx = process.argv.indexOf("--cwd-substr");
const cwdSub =
  cwdIdx >= 0
    ? process.argv[cwdIdx + 1]
    : "headless-cocos-research\\harness-bench\\docker-workspace";

function parseSSE(text) {
  return text
    .split(/\n/)
    .filter((l) => l.startsWith("data: "))
    .map((l) => JSON.parse(l.slice(6)));
}

async function mcp(method, params, id = 1) {
  const body = method.startsWith("notifications/")
    ? { jsonrpc: "2.0", method }
    : { jsonrpc: "2.0", id, method, params };
  const res = await fetch(mcpUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (method.startsWith("notifications/")) return null;
  const last = parseSSE(text).at(-1);
  if (last?.error) throw new Error(JSON.stringify(last.error));
  return last?.result;
}

await mcp("initialize", {
  protocolVersion: "2025-03-26",
  capabilities: {},
  clientInfo: { name: "harness-evox-cleanup", version: "0.1" },
});
await mcp("notifications/initialized");

const listed = await mcp("tools/call", { name: "list_sessions", arguments: {} });
const raw = listed?.content?.[0]?.text || "[]";
const sessions = JSON.parse(raw);
const targets = sessions.filter((s) => {
  if (all) return true;
  const cwd = String(s.cwd || "");
  const title = String(s.title || "");
  return (
    cwd.includes(cwdSub) ||
    /harness|Read \.harness-prompt|Cocos assets/i.test(title)
  );
});
console.log(`listed=${sessions.length} archive_targets=${targets.length}`);

let ok = 0;
let fail = 0;
for (const s of targets) {
  try {
    const r = await mcp(
      "tools/call",
      { name: "archive_session", arguments: { session_id: s.id } },
      ok + fail + 10,
    );
    const text = r?.content?.[0]?.text || JSON.stringify(r);
    console.log("archived", s.id, text.slice(0, 120));
    ok++;
  } catch (e) {
    console.error("fail", s.id, e instanceof Error ? e.message : e);
    fail++;
  }
}
console.log(JSON.stringify({ ok, fail, remaining_estimate: sessions.length - ok }));
