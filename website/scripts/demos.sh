#!/bin/sh
# Encodes the demo clips recorded by `DEVDOCK_DEMOS_DIR=<dir> npx playwright test demos` into
# website/public/video/<name>.mp4 (H.264, for Safari) and .webm (VP9, smaller), plus a still
# poster website/public/img/demo-<name>.webp (what reduced-motion users see: the clip's last
# frame, or the moment marked as "<name>:poster" in marks.json). Trims each clip's start-up using <dir>/marks.json. Needs ffmpeg, ffprobe and cwebp.
#   sh website/scripts/demos.sh <dir>
set -e
src="$1"
[ -d "$src" ] || { echo "usage: sh website/scripts/demos.sh <recorded dir>"; exit 1; }
vid=website/public/video
img=website/public/img
mkdir -p "$vid" "$img"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
for dir in "$src"/*/; do
  name=$(basename "$dir")
  in="$dir$name.webm"
  [ -f "$in" ] || continue
  start=$(node -e "const m=require('$src/marks.json'); console.log(Math.max(0, (m['$name'] ?? 0) - 0.2))")
  # 1240x820 recorded; 1240 wide on the page at most. 24 fps is plenty for UI.
  ffmpeg -loglevel error -y -ss "$start" -i "$in" -an -vf "fps=24,scale='min(1240,iw)':-2:flags=lanczos" \
    -c:v libx264 -preset slow -crf 27 -pix_fmt yuv420p -movflags +faststart "$vid/$name.mp4"
  ffmpeg -loglevel error -y -ss "$start" -i "$in" -an -vf "fps=24,scale='min(1240,iw)':-2:flags=lanczos" \
    -c:v libvpx-vp9 -b:v 0 -crf 40 -row-mt 1 "$vid/$name.webm"
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$vid/$name.mp4")
  at=$(node -e "const p=require('$src/marks.json')['$name:poster']; console.log(p === undefined ? Math.max(0, $dur - 0.3) : Math.max(0, p - $start))")
  ffmpeg -loglevel error -y -ss "$at" -i "$vid/$name.mp4" -frames:v 1 "$tmp/$name.png"
  cwebp -quiet -q 80 "$tmp/$name.png" -o "$img/demo-$name.webp"
  printf '%-14s %5.1fs  mp4 %4s KB  webm %4s KB\n' "$name" "$dur" \
    $(( $(wc -c < "$vid/$name.mp4") / 1024 )) $(( $(wc -c < "$vid/$name.webm") / 1024 ))
done
