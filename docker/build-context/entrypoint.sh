#!/bin/sh
# Cocos Creator's preview import-map references chunks whose hashes derive
# from the original (usually Windows) file:// project URL. The mini-packer
# recreates those URLs via PROJECT_URL, but mod-lo still stat()s the resolved
# path — so map that path onto /workspace with a symlink, whatever it is.
if [ -n "$PROJECT_URL" ]; then
  p="${PROJECT_URL#file:///}"
  d=$(dirname "/$p")
  mkdir -p "$d" 2>/dev/null || true
  ln -sfn /workspace "/$p" 2>/dev/null || true
fi
exec node /app/preview-mirror.mjs
