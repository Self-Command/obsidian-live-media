# Offline codec source and build

All plugin builds run in Actions. The plugin's own code is GPL-3.0-only.

- FFmpeg single-thread WASM is built in Actions using `scripts/build-ffmpeg.sh`. Its public bindings come from `ffmpegwasm/ffmpeg.wasm@71aa99d37c02a7b4c435275ca9ef50e612f6efa1`; FFmpeg n5.1.4, x264, libwebp and zlib are checked out at explicit object IDs in that script. The minimal core contains only the codecs needed by verified compression routes. `@ffmpeg/core` 0.12.10 remains a development reference, not the distributed binary.
- UltraHDR: `google/libultrahdr@66821e0a261aa3a06c0e7c889f52eced52850be1`, Apache-2.0 OR MIT. Our independently written public C-API bridge is in `ultrahdr.cpp`.
- JPEG dependency: upstream pins libjpeg-turbo 3.1.0. Exact resolved SHA is in `codecs/generated/jpeg.sha` from the same run.
- UltraHDR bridge toolchain: emsdk 4.0.15, source SHA `389a68bc35dcff7ebae4614e1615099dafda00d1`.

Actions archives upstream source trees, all license files, our bridge and build scripts. Each package includes `provenance.json`, with decoded resource hashes and the plugin commit/run/attempt. The plugin embeds gzip-compressed Worker/JS/WASM resources in `main.js`; it does not fetch a CDN or extra install files.

The source archive contains the exact checkouts used by the same Actions build, including our build scripts and generated configuration. It does not substitute current branch source for a publisher's historical binary. Byte-for-byte reproducibility across different runners remains a separate check; it is not implied by source provenance. Actual Obsidian/mobile validation is also required before a formal release.
