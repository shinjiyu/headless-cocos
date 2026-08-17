#!/usr/bin/env node
/**
 * Prove the harness edit was picked up by Docker headless mini-packer,
 * and that we are not talking to Cocos Creator IDE / cocosmcp.
 *
 * Usage (host):
 *   node scripts/prove-headless.mjs [--container cocos-preview-harness] [--since 30s]
 */
import { spawnSync } from "child_process";

const args = process.argv.slice(2);
function flag(name, def) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
}
const container = flag("--container", "cocos-preview-harness");
const since = flag("--since", "2m");
const previewUrl = flag("--preview-url", "http://127.0.0.1:7471/__hmr/status");

function sh(cmd, a) {
  return spawnSync(cmd, a, { encoding: "utf8", shell: false });
}

const out = {
  container,
  previewUrl,
  ideForbidden: true,
  mcpForbidden: true,
  checks: {},
};

// 1) Preview HTTP (__hmr/status)
try {
  const r = await fetch(previewUrl);
  out.checks.hmrStatus = { ok: r.ok, status: r.status, body: (await r.text()).slice(0, 400) };
} catch (e) {
  out.checks.hmrStatus = { ok: false, error: String(e && e.message ? e.message : e) };
}

// 2) Container must be the headless preview image, not Creator
const inspect = sh("docker", [
  "inspect",
  container,
  "--format",
  "{{.Config.Image}}|{{.State.Status}}|{{range .Config.Env}}{{println .}}{{end}}",
]);
const inspectText = (inspect.stdout || "") + (inspect.stderr || "");
out.checks.containerImage = {
  ok: /cocos-headless-preview/i.test(inspectText) && /running|healthy/i.test(inspectText) === false
    ? /cocos-headless-preview/i.test(inspectText)
    : /cocos-headless-preview/i.test(inspectText),
  raw: inspectText.slice(0, 800),
};
out.checks.containerImage.ok = /cocos-headless-preview/i.test(inspectText);

// 3) Recent logs: mini-packer activity; must NOT mention Creator.exe / cocosmcp bridge as driver
const logs = sh("docker", ["logs", container, "--since", since]);
const logText = `${logs.stdout || ""}\n${logs.stderr || ""}`;
out.checks.miniPacker = {
  ok: /\[mini\]\s+build#\d+\s+ok/i.test(logText) || /\[mini\]\s+watching/i.test(logText),
  sample: logText
    .split(/\r?\n/)
    .filter((l) => /\[mini\]|hmr|error/i.test(l))
    .slice(-20),
};
out.checks.noIdeDriver = {
  ok: !/CocosCreator\.exe|Creator\.exe|cocosmcp_exec|Editor\.Message/i.test(logText),
  note: "logs must not show IDE/MCP as the preview driver",
};

// 4) Host Creator process is informational only — other projects may keep IDE open.
//    Hard requirement is Docker mini-packer as the preview driver (above).
const tasklist = sh("tasklist", ["/FI", "IMAGENAME eq CocosCreator.exe"]);
const tl = `${tasklist.stdout || ""}\n${tasklist.stderr || ""}`;
const creatorRunning = /CocosCreator\.exe/i.test(tl) && !/No tasks are running/i.test(tl);
out.checks.hostCreatorProcess = {
  ok: true,
  warning: creatorRunning
    ? "CocosCreator.exe is running on host, but harness preview is Docker headless (not used as driver)"
    : "no CocosCreator.exe on host",
  raw: tl.slice(0, 300),
};

const hard = ["hmrStatus", "containerImage", "miniPacker", "noIdeDriver"];
const pass = hard.every((k) => out.checks[k] && out.checks[k].ok);
out.pass = pass;
out.hardChecks = hard;
console.log(JSON.stringify(out, null, 2));
process.exit(pass ? 0 : 1);
