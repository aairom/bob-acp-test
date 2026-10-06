#!/usr/bin/env bash
# scripts/package.sh
# Packages the extension into a .vsix file for local installation.
# Displays the URL/path to install it once done.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "==> ACP for VSCode — Package Extension"
cd "$PROJECT_ROOT"

if [ ! -d node_modules ]; then
  echo "[setup] Installing dependencies..."
  npm install
fi

echo "[1/2] Production build..."
npm run compile

echo "[2/2] Creating .vsix package..."
# --allow-missing-repository: suppresses the vsce warning when the repository URL
# cannot be resolved (e.g. placeholder URL or offline CI environment).
# Remove this flag after updating 'repository.url' in package.json to your real repo.
npx @vscode/vsce package --no-dependencies --allow-missing-repository

VSIX_FILE=$(ls -t "$PROJECT_ROOT"/*.vsix 2>/dev/null | head -1)

if [ -z "$VSIX_FILE" ]; then
  echo "ERROR: No .vsix file found after packaging."
  exit 1
fi

echo ""
echo "=========================================================="
echo " Extension packaged successfully!"
echo " File: $VSIX_FILE"
echo ""
echo " To install in VS Code:"
echo "   code --install-extension \"$VSIX_FILE\""
echo ""
echo " Or via Extensions view:"
echo "   Ctrl+Shift+P → Extensions: Install from VSIX..."
echo "=========================================================="
