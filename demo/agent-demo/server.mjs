import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAgent } from "./lib/run-agent.mjs";
import { loadKb, ingestRun, listRecentRuns, topHotFiles } from "./lib/prompt-kb.mjs";
import { findTranscript, mineTranscriptFile, mineAllTranscripts } from "./lib/transcript-mine.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "public");

const PORT = Number(process.env.PORT || 8790);
const PROJECT_ROOT = path.resolve(process.env.PROJECT_ROOT || "/workspace");
const PREVIEW_URL = process.env.PREVIEW_URL || "http://127.0.0.1:7470/";
const DEFAULT_BACKEND = (process.env.BACKEND || "stub").toLowerCase();
const AGENTS_MD = path.join(PROJECT_ROOT, "AGENTS.md");
const AGENTS_SRC = path.join(__dirname, "workspace-AGENTS.md");

let busy = false;
/** @type {import('http').ServerResponse[]} */
const sseClients = [];

function broadcast(obj) {
  const line = `data: ${JSON.stringify(obj)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(line);
    } catch {
      /* ignore */
    }
  }
}

function ensureAgentsMd() {
  try {
    if (!fs.existsSync(PROJECT_ROOT)) return;
    const body = fs.readFileSync(AGENTS_SRC, "utf8");
    const existing = fs.existsSync(AGENTS_MD) ? fs.readFileSync(AGENTS_MD, "utf8") : "";
    if (existing !== body) {
      fs.writeFileSync(AGENTS_MD, body, "utf8");
      console.log(`[demo] wrote ${AGENTS_MD}`);
    }
  } catch (err) {
    console.warn(`[demo] AGENTS.md skip: ${err.message}`);
  }
}

function mime(p) {
  if (p.endsWith(".html")) return "text/html; charset=utf-8";
  if (p.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (p.endsWith(".css")) return "text/css; charset=utf-8";
  if (p.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function learnFromResult(backend, prompt, ms, result) {
  let mined = { reads: [], writes: [], tools: [], toolCount: 0 };
  if (result?.agentId) {
    const tp = findTranscript(result.agentId, PROJECT_ROOT);
    if (tp) mined = mineTranscriptFile(tp, PROJECT_ROOT);
  }
  if (backend === "stub" && result?.files?.length) {
    mined.writes = result.files.map((f) => String(f).replace(/\\/g, "/"));
  }
  const kb = ingestRun(PROJECT_ROOT, {
    backend,
    prompt: String(prompt).slice(0, 500),
    ms,
    agentId: result?.agentId || null,
    runId: result?.runId || null,
    status: result?.status || null,
    reads: mined.reads,
    writes: mined.writes,
    tools: mined.tools,
    toolCount: mined.toolCount,
  });
  return { mined, kb };
}

ensureAgentsMd();
try {
  const kb0 = loadKb(PROJECT_ROOT);
  if (Object.keys(kb0.hotReads || {}).length === 0) {
    const all = mineAllTranscripts(PROJECT_ROOT);
    if (all.reads.length || all.writes.length) {
      ingestRun(PROJECT_ROOT, {
        backend: "seed",
        prompt: "(seed from existing transcripts)",
        ms: 0,
        reads: all.reads,
        writes: all.writes,
        tools: all.tools.slice(0, 50),
        toolCount: all.toolCount,
      });
      console.log(`[demo] seeded KB from ${all.files} transcript(s), reads=${all.reads.length}`);
    }
  }
} catch (err) {
  console.warn(`[demo] KB seed skip: ${err.message}`);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);

  if (req.method === "GET" && url.pathname === "/api/health") {
    const kb = loadKb(PROJECT_ROOT);
    return sendJson(res, 200, {
      ok: true,
      projectRoot: PROJECT_ROOT,
      previewUrl: PREVIEW_URL,
      backend: DEFAULT_BACKEND,
      busy,
      hasApiKey: Boolean(String(process.env.CURSOR_API_KEY || "").trim()),
      projectExists: fs.existsSync(PROJECT_ROOT),
      probeExists: fs.existsSync(path.join(PROJECT_ROOT, "assets", "scripts", "HeadlessProbe.ts")),
      kb: {
        hotFiles: topHotFiles(kb, 5),
        stats: kb.stats,
        updatedAt: kb.updatedAt,
      },
    });
  }

  if (req.method === "GET" && url.pathname === "/api/kb") {
    const kb = loadKb(PROJECT_ROOT);
    return sendJson(res, 200, { ok: true, kb, hotFiles: topHotFiles(kb, 20) });
  }

  if (req.method === "GET" && url.pathname === "/api/runs") {
    return sendJson(res, 200, { ok: true, runs: listRecentRuns(PROJECT_ROOT, 30) });
  }

  if (req.method === "POST" && url.pathname === "/api/kb/rescan") {
    const all = mineAllTranscripts(PROJECT_ROOT);
    const kb = ingestRun(PROJECT_ROOT, {
      backend: "rescan",
      prompt: "(rescan transcripts)",
      ms: 0,
      reads: all.reads,
      writes: all.writes,
      tools: all.tools.slice(0, 80),
      toolCount: all.toolCount,
    });
    return sendJson(res, 200, { ok: true, mined: all, kb, hotFiles: topHotFiles(kb, 20) });
  }

  if (req.method === "GET" && url.pathname === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify({ type: "hello", busy })}\n\n`);
    sseClients.push(res);
    req.on("close", () => {
      const i = sseClients.indexOf(res);
      if (i >= 0) sseClients.splice(i, 1);
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/run") {
    if (busy) return sendJson(res, 409, { ok: false, error: "busy" });
    let payload = {};
    try {
      payload = JSON.parse((await readBody(req)) || "{}");
    } catch {
      return sendJson(res, 400, { ok: false, error: "invalid json" });
    }
    const backend = String(payload.backend || DEFAULT_BACKEND).toLowerCase();
    const prompt =
      payload.prompt ||
      "Bump HeadlessProbe.PROBE_VERSION by 1 and set DEMO_LABEL to DEMO_OK. Keep the class otherwise unchanged.";

    busy = true;
    broadcast({ type: "run_start", backend, prompt });
    const t0 = Date.now();
    try {
      const result = await runAgent({
        backend,
        projectRoot: PROJECT_ROOT,
        userText: prompt,
        apiKey: process.env.CURSOR_API_KEY,
        model: process.env.CURSOR_MODEL,
        onEvent: (ev) => broadcast(ev),
      });
      const ms = Date.now() - t0;
      const learned = learnFromResult(backend, prompt, ms, result);
      const out = {
        ok: true,
        ms,
        ...result,
        learned: {
          reads: learned.mined.reads,
          writes: learned.mined.writes,
          toolCount: learned.mined.toolCount,
          hotFiles: topHotFiles(learned.kb, 8),
          avgMs: learned.kb.stats?.avgMs,
        },
      };
      broadcast({ type: "run_done", ...out });
      return sendJson(res, 200, out);
    } catch (err) {
      const out = { ok: false, ms: Date.now() - t0, error: String(err?.message || err) };
      broadcast({ type: "run_error", ...out });
      return sendJson(res, 500, out);
    } finally {
      busy = false;
    }
  }

  let rel = url.pathname === "/" ? "/index.html" : url.pathname;
  rel = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end("not found");
  }
  res.writeHead(200, { "Content-Type": mime(file), "Cache-Control": "no-store" });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[demo] agent UI http://127.0.0.1:${PORT}/`);
  console.log(`[demo] preview iframe → ${PREVIEW_URL}`);
  console.log(`[demo] project=${PROJECT_ROOT} backend=${DEFAULT_BACKEND}`);
  console.log(`[demo] contract=NO MCP — disk edits only → headless HMR`);
  console.log(`[demo] prompt-iter KB → ${path.join(PROJECT_ROOT, ".ai-workspace", "prompt-iter")}`);
});
