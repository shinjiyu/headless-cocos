/**
 * Cursor Agent CLI 封装（对齐 AIWS）：
 * Windows 优先 LOCALAPPDATA/cursor-agent/versions/<ver>/node.exe index.js，
 * 避免 spawn cursor-agent.cmd → PowerShell 挂死 / ENOENT。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * @returns {{
 *   kind: 'node'|'bin',
 *   nodeBin?: string,
 *   indexJs?: string,
 *   bin?: string,
 *   version?: string,
 *   label: string,
 * }}
 */
export function resolveAgentLaunch(hint) {
  if (hint && fs.existsSync(hint) && !/\.cmd$/i.test(hint) && !/\.ps1$/i.test(hint)) {
    if (/node(\.exe)?$/i.test(hint)) {
      return { kind: 'bin', bin: hint, label: hint };
    }
    return { kind: 'bin', bin: hint, label: hint };
  }

  const localApp = process.env.LOCALAPPDATA || '';
  const versionsRoot = path.join(localApp, 'cursor-agent', 'versions');
  if (fs.existsSync(versionsRoot)) {
    const dirs = fs
      .readdirSync(versionsRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((n) => /^\d{4}\.\d{1,2}\.\d{1,2}/.test(n) || n === 'dist-package')
      .sort((a, b) => {
        // dated versions first (desc), dist-package last among ties
        if (a === 'dist-package') return 1;
        if (b === 'dist-package') return -1;
        return b.localeCompare(a);
      });
    for (const name of dirs) {
      const nodeBin = path.join(versionsRoot, name, 'node.exe');
      const indexJs = path.join(versionsRoot, name, 'index.js');
      if (fs.existsSync(nodeBin) && fs.existsSync(indexJs)) {
        return {
          kind: 'node',
          nodeBin,
          indexJs,
          version: name,
          label: `node ${name}/index.js`,
        };
      }
      // linux-style package without bundled node
      const indexOnly = path.join(versionsRoot, name, 'index.js');
      if (fs.existsSync(indexOnly)) {
        return {
          kind: 'node',
          nodeBin: process.execPath,
          indexJs: indexOnly,
          version: name,
          label: `node ${name}/index.js`,
        };
      }
    }
  }

  const winCmd = path.join(localApp, 'cursor-agent', 'cursor-agent.cmd');
  if (fs.existsSync(winCmd)) {
    return { kind: 'bin', bin: winCmd, label: winCmd };
  }

  const unixCandidates = [
    hint,
    '/root/.local/bin/agent',
    '/root/.local/bin/cursor-agent',
    '/root/.cursor/bin/agent',
    path.join(os.homedir(), '.local/bin/agent'),
    path.join(os.homedir(), '.local/bin/cursor-agent'),
    '/usr/local/bin/agent',
  ].filter(Boolean);
  for (const c of unixCandidates) {
    if (c.includes('/') || c.includes('\\')) {
      if (fs.existsSync(c)) return { kind: 'bin', bin: c, label: c };
    }
  }

  return { kind: 'bin', bin: hint || 'agent', label: hint || 'agent' };
}

function killTree(child) {
  if (!child?.pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } else {
      child.kill('SIGKILL');
    }
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {{
 *   apiKey?: string|null,
 *   agentBin?: string,
 *   model?: string,
 *   timeoutMs?: number,
 * }} [cfg]
 */
export function createCursorCli(cfg = {}) {
  let apiKey = String(cfg.apiKey || process.env.CURSOR_API_KEY || '').trim();
  if (!apiKey && cfg.resolveKey) {
    try {
      apiKey = String(cfg.resolveKey() || '').trim();
    } catch {
      apiKey = '';
    }
  }
  const launch = resolveAgentLaunch(cfg.agentBin || process.env.CURSOR_AGENT_BIN);
  const model = cfg.model || process.env.CURSOR_MODEL || '';
  const timeoutMs = Number(cfg.timeoutMs || process.env.CURSOR_TIMEOUT_MS || 600000);

  function agentEnv() {
    const env = { ...process.env };
    if (apiKey) env.CURSOR_API_KEY = apiKey;
    return env;
  }

  function hasApiKey() {
    return !!apiKey;
  }

  function spawnAgent(cliArgs, { cwd }) {
    if (launch.kind === 'node' && launch.nodeBin && launch.indexJs) {
      return spawn(launch.nodeBin, [launch.indexJs, ...cliArgs], {
        cwd,
        env: agentEnv(),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    }
    const bin = launch.bin || 'agent';
    // Windows .cmd needs shell so PATH / bat wrappers work
    const needShell = process.platform === 'win32' && /\.cmd$/i.test(bin);
    return spawn(bin, cliArgs, {
      cwd,
      env: agentEnv(),
      windowsHide: true,
      shell: needShell,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  /**
   * @param {string} prompt
   * @param {{ cwd: string, onLog?: (s: string) => void }} opts
   */
  function runPrompt(prompt, { cwd, onLog } = {}) {
    return new Promise((resolve) => {
      if (!apiKey) {
        resolve({
          ok: false,
          code: -1,
          stdout: '',
          stderr: '',
          error: 'CURSOR_API_KEY missing',
        });
        return;
      }
      if (!cwd || !fs.existsSync(cwd)) {
        resolve({
          ok: false,
          code: -1,
          stdout: '',
          stderr: '',
          error: `cwd missing: ${cwd}`,
        });
        return;
      }

      const args = ['-p', '--force', '--trust', '--workspace', cwd];
      if (model) args.push('--model', model);
      args.push(prompt);

      onLog?.(`spawn ${launch.label} -p --force --trust --workspace ${cwd}`);

      let child;
      try {
        child = spawnAgent(args, { cwd });
      } catch (err) {
        resolve({
          ok: false,
          code: -1,
          stdout: '',
          stderr: '',
          error: err?.message || String(err),
        });
        return;
      }

      let stdout = '';
      let stderr = '';
      let settled = false;

      const finish = (payload) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        setTimeout(() => killTree(child), 300);
        resolve(payload);
      };

      const timer = setTimeout(() => {
        killTree(child);
        finish({
          ok: false,
          code: -1,
          stdout,
          stderr,
          error: `cursor-agent timeout after ${timeoutMs}ms`,
        });
      }, timeoutMs);

      child.stdout?.on('data', (buf) => {
        const s = buf.toString('utf8');
        stdout += s;
        onLog?.(s.trimEnd());
      });
      child.stderr?.on('data', (buf) => {
        const s = buf.toString('utf8');
        stderr += s;
        onLog?.(s.trimEnd());
      });
      child.on('error', (err) => {
        const msg = err?.message || String(err);
        const hint =
          /ENOENT/i.test(msg)
            ? `${msg}（未找到 Agent：请确认已安装 Cursor CLI，或设 LOADING_PREVIEW_FALLBACK=1）`
            : msg;
        finish({
          ok: false,
          code: -1,
          stdout,
          stderr,
          error: hint,
        });
      });
      child.on('close', (code) => {
        finish({
          ok: code === 0,
          code: code ?? -1,
          stdout,
          stderr,
          error: code === 0 ? null : `cursor-agent exit ${code}`,
        });
      });
    });
  }

  return {
    hasApiKey,
    runPrompt,
    agentBin: launch.label,
    launch,
    timeoutMs,
  };
}

/**
 * @param {string} jobDir
 * @param {string} skillsRoot
 */
export function prepareJobAgentWorkspace(jobDir, skillsRoot) {
  const skillSrc = path.join(skillsRoot, 'loading-h5-preview');
  const skillDst = path.join(jobDir, '.cursor', 'skills', 'loading-h5-preview');
  fs.mkdirSync(path.dirname(skillDst), { recursive: true });
  fs.cpSync(skillSrc, skillDst, { recursive: true, force: true });

  const agentsMd = `# Agent notes

本作业是 Loading Splash 预览任务。

1. 先读 skill \`loading-h5-preview\`（\.cursor/skills/loading-h5-preview/SKILL.md）
2. 优先执行：\`node /app/scripts/build-loading-h5.mjs --job-dir .\`
   （本机开发也可用相对路径找到 portal/scripts/build-loading-h5.mjs）
3. 确认 \`loading-h5/index.html\` 存在；可微调 CSS，禁止引入 Cocos
4. 不要 git commit；不要修改 source.psd
`;
  fs.writeFileSync(path.join(jobDir, 'AGENTS.md'), agentsMd, 'utf8');
}
