#!/bin/bash
set -euo pipefail

# DBMind Release Build Script
# Builds Windows x64 + macOS Intel/ARM installers
#
# Prerequisites:
#   - Node.js >= 18
#   - npm
#   - wine (for Windows build on macOS — `brew install --cask wine-stable`)
#
# Usage:
#   chmod +x scripts/build-release.sh
#   ./scripts/build-release.sh

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

echo "=== Cleaning output directory ==="
rm -rf "$SCRIPT_DIR/release"

echo "=== Building application (tsc + vite + electron) ==="
npm run build

echo "=== Creating multi-platform installers ==="
echo "  -> macOS (x64 + arm64)"
echo "  -> Windows (x64 + arm64)"
npx electron-builder --mac --win --x64 --arm64

echo ""
echo "=== Build complete ==="
echo ""
ls -lh "$SCRIPT_DIR/release/"*.dmg "$SCRIPT_DIR/release/"*.exe 2>/dev/null
echo ""
echo "Output files:"
ls "$SCRIPT_DIR/release/" 2>/dev/null
