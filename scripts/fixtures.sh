#!/usr/bin/env bash
set -euo pipefail
mkdir -p dist/fixtures
ffmpeg -v error -f lavfi -i 'testsrc2=s=128x128:r=16:d=2' -f lavfi -i 'sine=frequency=440:sample_rate=48000:duration=2' \
  -c:v libx264 -crf 10 -pix_fmt yuv420p -c:a aac -movflags +faststart dist/fixtures/audio-motion.mp4
ffmpeg -v error -f lavfi -i 'testsrc2=s=128x128:r=32:d=2' -vf "setpts='if(lt(N,32),N/32/TB,(1+(N-32)/24)/TB)'" \
  -c:v libx264 -crf 10 -pix_fmt yuv420p -fps_mode passthrough -video_track_timescale 96000 -movflags +faststart dist/fixtures/vfr-motion.mp4
printf '%s\n' 'Synthetic test patterns and tones generated in Actions; no private media. Public-domain fixture recipe.' > dist/fixtures/LICENSE.txt
