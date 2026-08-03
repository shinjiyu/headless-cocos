FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    python3 \
    curl \
    ca-certificates \
    git \
    bash \
  && rm -rf /var/lib/apt/lists/*

# Cursor Agent CLI（容器内非交互；鉴权用 CURSOR_API_KEY）
RUN curl -fsSL https://cursor.com/install | bash \
  && ln -sf /root/.local/bin/agent /usr/local/bin/agent || true \
  && ln -sf /root/.local/bin/cursor-agent /usr/local/bin/cursor-agent || true

ENV PATH="/root/.local/bin:/root/.cursor/bin:${PATH}"

WORKDIR /app

COPY portal/package.json portal/package-lock.json* ./
RUN npm install --omit=dev

COPY portal/server.mjs ./
COPY portal/lib ./lib
COPY portal/public ./public
COPY portal/fixtures ./fixtures
COPY portal/scripts ./scripts
COPY .cursor ./.cursor

ENV PORT=8800 \
    JOBS_ROOT=/data/jobs \
    PUBLIC_BASE=http://127.0.0.1:8800 \
    MAX_UPLOAD_BYTES=2147483648 \
    PARSE_MAX_TILES=0 \
    SKILLS_ROOT=/app/.cursor/skills \
    LOADING_TEMPLATES_DIR=/app/.cursor/skills/loading-h5-preview/templates \
    LOADING_PREVIEW_FALLBACK=0

EXPOSE 8800
CMD ["node", "server.mjs"]
