#!/usr/bin/env bash
# scripts/cleanup.sh
# Removes generated build artefacts, node_modules, Python environments,
# and __pycache__ directories to return the project to a clean state.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "==> ACP for VSCode — Project Cleanup"
cd "$PROJECT_ROOT"

echo "Removing node_modules..."
rm -rf "$PROJECT_ROOT/node_modules"

echo "Removing compiled output (out/)..."
rm -rf "$PROJECT_ROOT/out"

echo "Removing .vsix packages..."
rm -f "$PROJECT_ROOT"/*.vsix

echo "Removing Python environments (.venv)..."
rm -rf "$PROJECT_ROOT/.venv"

echo "Removing Python cache (__pycache__)..."
find "$PROJECT_ROOT" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true

echo ""
echo "Cleanup complete. Run 'scripts/build.sh' to rebuild."
