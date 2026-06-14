#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$SCRIPT_DIR/scrollpay-extension"
OUT_DIR="$SCRIPT_DIR/dist"
VERSION=$(node -p "require('$EXT_DIR/manifest.json').version")
ZIP_NAME="scrollpay-extension-v${VERSION}.zip"

mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR/$ZIP_NAME"

cd "$EXT_DIR"

zip -r "$OUT_DIR/$ZIP_NAME" \
  manifest.json \
  background.js \
  content.js \
  popup.html \
  popup.js \
  popup.css \
  widget.css \
  onboarding.html \
  onboarding.js \
  onboarding.css \
  privacy.html \
  icons/ \
  vendor/

echo "✓ Packaged: dist/$ZIP_NAME"
