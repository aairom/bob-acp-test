#!/usr/bin/env bash
# scripts/dev.sh
# Starts the TypeScript compiler in watch mode for active development.
# The compiler re-runs automatically on every file save.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "==> ACP for VSCode — Development Watch Mode"
cd "$PROJECT_ROOT"

if [ ! -d node_modules ]; then
  echo "[setup] Installing dependencies..."
  npm install
fi

echo "Watching for TypeScript changes…"
echo "Press Ctrl+C to stop."
echo ""
npm run watch
