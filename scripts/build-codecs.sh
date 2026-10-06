#!/usr/bin/env bash
set -euo pipefail
mkdir -p codecs/generated build/codec-sources
git clone --quiet https://github.com/google/libultrahdr.git build/codec-sources/libultrahdr
git -C build/codec-sources/libultrahdr checkout --quiet 66821e0a261aa3a06c0e7c889f52eced52850be1
# The upstream jpeg dependency is pinned to its 3.1.0 release. Archive the resolved commit.
emcmake cmake -G Ninja -S codecs -B build/hdr -DUHDR_SOURCE="$PWD/build/codec-sources/libultrahdr"
cmake --build build/hdr --parallel 2
cp build/hdr/live_hdr.{js,wasm} codecs/generated/
git -C build/codec-sources/libultrahdr rev-parse HEAD > codecs/generated/ultrahdr.sha
git -C build/codec-sources/libultrahdr/third_party/turbojpeg rev-parse HEAD > codecs/generated/jpeg.sha
