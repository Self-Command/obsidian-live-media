# Offline codec source and build

All plugin builds run in Actions. The plugin's own code is GPL-3.0-only.

- FFmpeg single-thread WASM: published `@ffmpeg/core` 0.12.10, npm integrity fixed by `package-lock.json`. Upstream release source: `ffmpegwasm/ffmpeg.wasm@71aa99d37c02a7b4c435275ca9ef50e612f6efa1`, release 2025-01-07. Its `Dockerfile` and `build/*.sh` describe all codec dependencies and Emscripten 3.1.40. Build using the upstream Docker recipe with `FFMPEG_ST=yes`; binaries used here are the published npm release, not a local rebuild.
- UltraHDR: `google/libultrahdr@66821e0a261aa3a06c0e7c889f52eced52850be1`, Apache-2.0 OR MIT. Our independently written public C-API bridge is in `ultrahdr.cpp`.
- JPEG dependency: upstream pins libjpeg-turbo 3.1.0. Exact resolved SHA is in `codecs/generated/jpeg.sha` from the same run.
- UltraHDR bridge toolchain: emsdk 4.0.15, source SHA `389a68bc35dcff7ebae4614e1615099dafda00d1`.

Actions archives upstream source trees, all license files, our bridge and build scripts. Each package includes `provenance.json`, with decoded resource hashes and the plugin commit/run/attempt. The plugin embeds gzip-compressed Worker/JS/WASM resources in `main.js`; it does not fetch a CDN or extra install files.

Important source limitation: some dependencies in the FFmpeg upstream release Dockerfile use branch names. Our source archive records the resolved checkout but cannot prove these are the exact historical revisions used by the publisher in January 2025. Rebuilding a fully pinned minimal FFmpeg core in Actions is required before a formal public release if this provenance gap cannot be resolved. A candidate is not advertised as reproducible or release-ready.
