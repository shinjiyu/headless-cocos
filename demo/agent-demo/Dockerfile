# Node 20 agent UI + @cursor/sdk (local cwd = /workspace).
# Communication with headless Cocos: disk writes only — no MCP.
# @cursor/sdk requires Node >= 22.13
FROM node:22-bookworm-slim

WORKDIR /demo

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server.mjs ./
COPY lib ./lib
COPY public ./public
COPY workspace-AGENTS.md ./

ENV PORT=8790 \
    PROJECT_ROOT=/workspace \
    PREVIEW_URL=http://127.0.0.1:7470/ \
    BACKEND=stub

EXPOSE 8790
CMD ["node", "server.mjs"]
