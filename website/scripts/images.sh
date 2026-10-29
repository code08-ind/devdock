#!/bin/sh
# Regenerates website/public/img from the app's demo-mode screenshots (docs/screenshots) and
# build/icon.png. Needs cwebp (brew install webp) and sips (macOS). Run from the repo root:
#   sh website/scripts/images.sh
set -e
out=website/public/img
mkdir -p "$out"
for f in readme-home readme-prs readme-builds readme-tickets readme-lessons readme-palette \
  readme-diagnostics readme-repos readme-terminal today-light today-dark; do
  cwebp -quiet -q 78 -resize 1600 0 "docs/screenshots/$f.png" -o "$out/$f.webp"
done
cwebp -quiet -q 82 docs/screenshots/readme-panel.png -o "$out/readme-panel.webp"
cwebp -quiet -q 82 -resize 400 0 docs/screenshots/readme-panel.png -o "$out/readme-panel-400.webp"
sips -z 192 192 build/icon.png --out "$out/icon-192.png" >/dev/null
sips -z 64 64 build/icon.png --out website/public/favicon.png >/dev/null
