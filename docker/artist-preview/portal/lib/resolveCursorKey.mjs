/**
 * 解析 CURSOR_API_KEY：
 * 1) 环境变量 CURSOR_API_KEY / AIWS_CURSOR_API_KEY
 * 2) 本仓库 config.local.json → secrets.cursorApiKey
 * 3) AIWS_CONFIG_LOCAL / ARTIST_PREVIEW_CONFIG_LOCAL 指向的 config.local.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readKeyFromConfigLocal(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return '';
  try {
    const doc = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const nested = doc?.secrets?.cursorApiKey;
    const flat = doc?.cursorApiKey;
    const key = String(nested || flat || '').trim();
    return key;
  } catch {
    return '';
  }
}

/**
 * @returns {{ key: string, source: string }}
 */
export function resolveCursorApiKey() {
  const fromEnv = String(
    process.env.CURSOR_API_KEY || process.env.AIWS_CURSOR_API_KEY || '',
  ).trim();
  if (fromEnv) return { key: fromEnv, source: 'env' };

  const localPaths = [
    process.env.ARTIST_PREVIEW_CONFIG_LOCAL,
    path.join(__dirname, '../../config.local.json'),
    process.env.AIWS_CONFIG_LOCAL,
  ].filter(Boolean);

  for (const p of localPaths) {
    const key = readKeyFromConfigLocal(p);
    if (key) return { key, source: p };
  }

  return { key: '', source: '' };
}
