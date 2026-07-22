# Headless Cocos Creator 3.8 preview server, containerized.
# Built from d:\tempWorkspace\headless-cocos-research\docker\build-context.
#
# Runtime layout inside the image:
#   /app/preview-mirror.mjs         mirror entrypoint
#   /app/packer/build.cjs           mini-packer child (spawned per rebuild)
#   /app/cache/                     preview shell (index.html, settings.js, ...)
#   /app/node_modules/@cocos/...    trimmed npm tree (~21 MB)  ← must live here
#                                    so Node's ESM resolver finds `ws` etc.
#   /app/vendor-utils/dist/uuid.js  compressUUID helper (Creator's, not on npm)
#   /engine/preview/                bundled cc engine (from a warmed Creator run)
#   /engine/native-external/        wasm blobs (spine, meshopt) served by mirror
#   /workspace                      Cocos project (bind-mount from host)
FROM node:20-bookworm-slim

WORKDIR /app

# Copy application code (mirror + mini-packer + preview shell)
COPY app/     /app/

# Vendored deps under /app/node_modules so Node module resolution finds them
# when running preview-mirror.mjs (walks up from /app/).
COPY vendor/node_modules /app/node_modules
COPY vendor/utils        /app/vendor-utils

# One-time engine snapshot (91 MB). Baked into the image so container is
# self-sufficient. To refresh: rebuild snapshot on host, rebuild image.
COPY engine/  /engine/

# Env — matches build.cjs / preview-mirror.mjs defaults for Linux paths.
ENV PACKER=mini \
    PORT=7460 \
    PROJECT=/workspace \
    NPM_ROOT=/app/node_modules \
    UUID_UTIL=/app/vendor-utils/dist/uuid.js \
    ENGINE_SNAPSHOT=/engine

# The PROJECT_URL → /workspace symlink is created at startup by entrypoint.sh
# (it depends on the runtime PROJECT_URL env, which varies per project).
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 7460

# Health probe: mirror exposes /__hmr/status even before any client connects.
# Use `wget` (busybox variant preinstalled in bookworm-slim) — cheaper than
# spawning a fresh Node process (which alone can eat ~1 s cold-start).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --spider -q "http://127.0.0.1:${PORT}/__hmr/status" || exit 1

CMD ["/entrypoint.sh"]
