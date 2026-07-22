import fs from "node:fs";
import path from "node:path";
import { wrapUserPrompt } from "./no-mcp-contract.mjs";
import { buildPrompt, loadKb } from "./prompt-kb.mjs";

const PROBE_REL = path.join("assets", "scripts", "HeadlessProbe.ts");

/**
 * Stub backend: prove no-MCP HMR without Cursor.
 * Bumps HeadlessProbe.PROBE_VERSION and stamps a DEMO_LABEL.
 */
export async function runStub({ projectRoot, userText, onEvent }) {
  const probePath = path.join(projectRoot, PROBE_REL);
  if (!fs.existsSync(probePath)) {
    throw new Error(`missing ${PROBE_REL} under ${projectRoot}`);
  }
  const before = fs.readFileSync(probePath, "utf8");
  const m = before.match(/PROBE_VERSION\s*=\s*(\d+)/);
  const next = m ? Number(m[1]) + 1 : 1;
  const label = String(userText || "STUB")
    .replace(/[^\w.-]+/g, "_")
    .slice(0, 48) || "STUB";

  let after = before;
  if (/PROBE_VERSION\s*=/.test(after)) {
    after = after.replace(/PROBE_VERSION\s*=\s*\d+/, `PROBE_VERSION = ${next}`);
  } else {
    after = after.replace(
      /export class HeadlessProbe[^{]*\{/,
      (s) => `${s}\n    static PROBE_VERSION = ${next};`,
    );
  }
  if (/DEMO_LABEL\s*=/.test(after)) {
    after = after.replace(/DEMO_LABEL\s*=\s*['"][^'"]*['"]/, `DEMO_LABEL = '${label}'`);
  } else {
    after = after.replace(
      /static PROBE_VERSION = \d+;/,
      (s) => `${s}\n    static DEMO_LABEL = '${label}';`,
    );
  }
  // Ensure start() logs the label
  if (!/DEMO_LABEL/.test(after.split("start(")[1] || "")) {
    after = after.replace(
      /console\.log\('\[HeadlessProbe\] ready v='\s*\+\s*HeadlessProbe\.PROBE_VERSION\);/,
      "console.log('[HeadlessProbe] ready v=' + HeadlessProbe.PROBE_VERSION + ' label=' + HeadlessProbe.DEMO_LABEL);",
    );
  }

  fs.writeFileSync(probePath, after, "utf8");
  onEvent?.({ type: "stub_write", path: PROBE_REL, version: next, label });
  return {
    backend: "stub",
    status: "finished",
    result: `stub wrote ${PROBE_REL} PROBE_VERSION=${next} DEMO_LABEL=${label}`,
    files: [PROBE_REL],
  };
}

/**
 * Real Cursor local agent via @cursor/sdk.
 * No MCP servers are passed — agent only has filesystem/shell in cwd.
 */
export async function runCursorSdk({ projectRoot, userText, apiKey, model, onEvent, useKb = true }) {
  const key = String(apiKey || process.env.CURSOR_API_KEY || "").trim();
  if (!key) throw new Error("CURSOR_API_KEY missing (set env or demo/.env)");

  const { Agent } = await import("@cursor/sdk");
  const kb = useKb ? loadKb(projectRoot) : null;
  const prompt = kb ? buildPrompt(userText, kb) : wrapUserPrompt(userText);
  const modelId = model || process.env.CURSOR_MODEL || "composer-2.5";

  onEvent?.({
    type: "sdk_start",
    model: modelId,
    cwd: projectRoot,
    kbHotFiles: kb ? Object.keys(kb.hotReads || {}).length : 0,
  });

  // Avoid `await using` so older Node can parse this file; SDK still wants Node 22+.
  const agent = await Agent.create({
    apiKey: key,
    model: { id: modelId },
    local: {
      cwd: projectRoot,
      // Do not load ambient MCP / user settings — headless contract only.
      settingSources: [],
    },
  });

  try {
    const run = await agent.send(prompt);
    const texts = [];
    for await (const event of run.stream()) {
      onEvent?.({ type: "sdk_event", eventType: event.type });
      if (event.type === "assistant") {
        for (const block of event.message?.content || []) {
          if (block.type === "text" && block.text) {
            texts.push(block.text);
            onEvent?.({ type: "assistant_text", text: block.text });
          }
        }
      }
    }
    const waited = await run.wait();
    return {
      backend: "sdk",
      status: waited?.status || "finished",
      result: texts.join("") || waited?.result || "",
      agentId: agent.agentId,
      runId: run.id,
    };
  } finally {
    try {
      await agent[Symbol.asyncDispose]?.();
    } catch {
      try {
        agent.close?.();
      } catch {
        /* ignore */
      }
    }
  }
}

export async function runAgent(opts) {
  const backend = String(opts.backend || process.env.BACKEND || "stub").toLowerCase();
  if (backend === "sdk" || backend === "cursor") {
    return runCursorSdk(opts);
  }
  return runStub(opts);
}
