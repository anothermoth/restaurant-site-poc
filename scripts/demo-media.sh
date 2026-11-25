#!/usr/bin/env bash
# Converts docs/demo.webm (from scripts/record-demo.mjs) to docs/demo.mp4 and docs/demo.gif.
set -euo pipefail
ffmpeg -y -loglevel error -i docs/demo.webm -c:v libx264 -preset slow -crf 30 -pix_fmt yuv420p -movflags +faststart -an docs/demo.mp4
ffmpeg -y -loglevel error -i docs/demo.webm -vf "fps=3,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" docs/demo.gif
rm -f docs/demo.webm
ls -la docs/demo.mp4 docs/demo.gif
