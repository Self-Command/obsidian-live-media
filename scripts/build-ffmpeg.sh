#!/usr/bin/env bash
set -euo pipefail
# All source checkouts are archived from this exact build. No publisher-provenance gap.
root="$PWD"
sources="$root/build/codec-sources"
mkdir -p "$sources" "$root/codecs/generated"
clone() {
  local name="$1" url="$2" ref="$3"
  git clone --quiet --filter=blob:none --no-checkout "$url" "$sources/$name"
  git -C "$sources/$name" checkout --quiet "$ref"
  git -C "$sources/$name" rev-parse HEAD >> "$root/codecs/generated/ffmpeg-sources.sha"
}
clone ffmpeg-wasm https://github.com/ffmpegwasm/ffmpeg.wasm.git 71aa99d37c02a7b4c435275ca9ef50e612f6efa1
clone ffmpeg https://github.com/FFmpeg/FFmpeg.git 80e7806be7f10c038bef2e71905e91af174c28e9
clone x264 https://github.com/ffmpegwasm/x264.git 33cac6b77d5b9259c552156013a817ab23119612
clone libwebp https://github.com/ffmpegwasm/libwebp.git 004d0a19143abc4494474da905b4eca34c7763db
clone zlib https://github.com/ffmpegwasm/zlib.git 7085a61bce3ed39d5e56ca4d01d80f4338c8a4a6
export INSTALL_DIR="$root/build/ffmpeg-prefix"
export FFMPEG_ST=yes
export CFLAGS="-O3 -I$INSTALL_DIR/include"
export CXXFLAGS="$CFLAGS"
export LDFLAGS="-L$INSTALL_DIR/lib $CFLAGS"
export EM_TOOLCHAIN_FILE="$EMSDK/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake"
export PKG_CONFIG_PATH="$INSTALL_DIR/lib/pkgconfig"
export EM_PKG_CONFIG_PATH="$PKG_CONFIG_PATH"
cd "$sources/zlib"
emconfigure ./configure --prefix="$INSTALL_DIR" --static
emmake make -j2
emmake make install
cd "$sources/x264"
bash "$sources/ffmpeg-wasm/build/x264.sh"
cd "$sources/libwebp"
bash "$sources/ffmpeg-wasm/build/libwebp.sh"
cd "$sources/ffmpeg"
bash "$sources/ffmpeg-wasm/build/ffmpeg.sh" \
  --disable-everything --enable-gpl --enable-libx264 --enable-libwebp --enable-zlib \
  --enable-avcodec --enable-avformat --enable-avfilter --enable-swscale --enable-swresample --enable-avdevice \
  --enable-protocol=file,pipe \
  --enable-demuxer=mov,image2,image2pipe,mjpeg,png_pipe,jpeg_pipe,webp_pipe \
  --enable-muxer=mp4,mov,image2,image2pipe,rawvideo,null,framehash \
  --enable-decoder=h264,hevc,mjpeg,png,webp,aac,pcm_s16le \
  --enable-encoder=libx264,mjpeg,png,libwebp,rawvideo,pcm_s16le \
  --enable-parser=h264,hevc,mjpeg,png,aac \
  --enable-bsf=extract_extradata,h264_mp4toannexb,hevc_mp4toannexb \
  --enable-indev=lavfi \
  --enable-filter=color,testsrc2,sine,format,scale,null,anull,aresample,buffer,buffersink,abuffer,abuffersink
mkdir -p src
cp -r "$sources/ffmpeg-wasm/src/bind" "$sources/ffmpeg-wasm/src/fftools" src/
bash "$sources/ffmpeg-wasm/build/ffmpeg-wasm.sh" \
  -lx264 -lwebpmux -lwebp -lsharpyuv -lz -o "$root/codecs/generated/ffmpeg-core.js"
