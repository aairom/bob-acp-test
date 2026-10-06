#!/usr/bin/env bash
# scripts/test.sh
# Runs the full unit + integration test suite.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "==> ACP for VSCode — Test Suite"
cd "$PROJECT_ROOT"

if [ ! -d node_modules ]; then
  echo "[setup] Installing dependencies..."
  npm install
fi

echo "[1/2] Compiling and linting..."
npm run pretest

echo "[2/2] Running tests..."
npm test

echo ""
echo "All tests passed."
