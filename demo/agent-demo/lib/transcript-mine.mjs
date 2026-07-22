/**
 * Mine Cursor agent transcript JSONL for Read/Write/tool usage.
 */

import fs from "node:fs";
import path from "node:path";

function toRel(p, projectRoot) {
  if (!p) return null;
  let s = String(p).replace(/\\/g, "/");
  const root = String(projectRoot || "").replace(/\\/g, "/").replace(/\/$/, "");
  if (s.startsWith("/workspace/")) s = s.slice("/workspace/".length);
  else if (root && s.toLowerCase().startsWith(root.toLowerCase() + "/")) {
    s = s.slice(root.length + 1);
  }
  s = s.replace(/^\.\//, "");
  if (!s || s.includes("*")) return null;
  // Absolute / meta paths pollute the hot-file KB and make later prompts worse.
  if (s.startsWith("/") || /^[A-Za-z]:\//.test(s)) return null;
  if (
    s.startsWith(".ai-workspace/") ||
    s.startsWith(".cursor/") ||
    s.startsWith("temp/") ||
    s.startsWith("library/") ||
    s.includes("agent-transcripts/") ||
    s.includes("sdk-agent-store/")
  ) {
    return null;
  }
  return s;
}

export function mineTranscriptFile(transcriptPath, projectRoot) {
  const out = {
    reads: [],
    writes: [],
    tools: [],
    toolCount: 0,
  };
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return out;

  const seenR = new Set();
  const seenW = new Set();

  for (const line of fs.readFileSync(transcriptPath, "utf8").split(/\n/)) {
    if (!line.trim()) continue;
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    for (const c of j.message?.content || []) {
      if (c.type !== "tool_use") continue;
      out.toolCount++;
      const name = c.name || "?";
      const arg =
        c.input?.path ||
        c.input?.glob_pattern ||
        c.input?.command ||
        c.input?.pattern ||
        "";
      out.tools.push({ name, arg: String(arg).slice(0, 200) });

      if (name === "Read") {
        const rel = toRel(c.input?.path, projectRoot);
        if (rel && !seenR.has(rel)) {
          seenR.add(rel);
          out.reads.push(rel);
        }
      }
      if (name === "Write" || name === "StrReplace") {
        const rel = toRel(c.input?.path, projectRoot);
        if (rel && !seenW.has(rel)) {
          seenW.add(rel);
          out.writes.push(rel);
        }
      }
    }
  }
  return out;
}

/**
 * Locate transcript for an agentId inside the container (or host mirror).
 */
export function findTranscript(agentId, projectRoot) {
  if (!agentId) return null;
  const candidates = [
    path.join(
      process.env.HOME || "/root",
      ".cursor/projects/workspace/agent-transcripts",
      agentId,
      `${agentId}.jsonl`,
    ),
    path.join(projectRoot, ".cursor", "agent-transcripts", agentId, `${agentId}.jsonl`),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/** Rescan all transcripts under ~/.cursor/.../agent-transcripts */
export function mineAllTranscripts(projectRoot) {
  const root = path.join(
    process.env.HOME || "/root",
    ".cursor/projects/workspace/agent-transcripts",
  );
  const aggregated = { reads: [], writes: [], tools: [], toolCount: 0, files: 0 };
  if (!fs.existsSync(root)) return aggregated;

  for (const dir of fs.readdirSync(root)) {
    const f = path.join(root, dir, `${dir}.jsonl`);
    if (!fs.existsSync(f)) continue;
    const m = mineTranscriptFile(f, projectRoot);
    aggregated.files++;
    aggregated.toolCount += m.toolCount;
    for (const r of m.reads) if (!aggregated.reads.includes(r)) aggregated.reads.push(r);
    for (const w of m.writes) if (!aggregated.writes.includes(w)) aggregated.writes.push(w);
    aggregated.tools.push(...m.tools);
  }
  return aggregated;
}
