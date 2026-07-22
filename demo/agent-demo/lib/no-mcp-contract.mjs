/**
 * Contract injected into every Cursor prompt.
 * Replaces the old AIWS path (Cursor ↔ Creator via cocos-meta-mcp).
 * New path: Cursor writes files → headless preview-mirror watches → HMR.
 */
export const NO_MCP_CONTRACT = `You are editing a Cocos Creator 3.8 project in a HEADLESS preview environment.

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
`;

export function wrapUserPrompt(userText) {
  return `${NO_MCP_CONTRACT}\n\n---\nUser request:\n${String(userText || "").trim()}\n`;
}
