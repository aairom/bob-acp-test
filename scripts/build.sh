#!/usr/bin/env bash
# scripts/build.sh
# Compiles the TypeScript extension and reports the output location.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "==> ACP for VSCode — Build"
cd "$PROJECT_ROOT"

echo "[1/2] Installing dependencies..."
npm install

echo "[2/2] Cleaning previous output..."
rm -rf "$PROJECT_ROOT/out"

echo "[3/3] Compiling TypeScript..."
npm run compile

echo ""
echo "Build complete. Output: $PROJECT_ROOT/out/"
