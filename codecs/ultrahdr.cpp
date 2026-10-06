// SPDX-License-Identifier: GPL-3.0-only
// Independent, minimal bridge to Google's public C API.
#include "ultrahdr_api.h"
#include <vector>
#include <cstring>
#include <emscripten/emscripten.h>
static std::vector<unsigned char> output;
static bool ok(uhdr_error_info_t e) { return e.error_code == UHDR_CODEC_OK; }
static uhdr_compressed_image_t input_image(void* p, int n) {
  uhdr_compressed_image_t image{};
  image.data = p; image.data_sz = n; image.capacity = n;
  image.cg = UHDR_CG_UNSPECIFIED; image.ct = UHDR_CT_UNSPECIFIED;
  image.range = UHDR_CR_UNSPECIFIED;
  return image;
}
extern "C" {
EMSCRIPTEN_KEEPALIVE int lm_output_size() { return output.size(); }
EMSCRIPTEN_KEEPALIVE int lm_probe(void* p, int n) {
  auto d = uhdr_create_decoder(); auto image = input_image(p, n);
  bool valid = ok(uhdr_dec_set_image(d, &image)) && ok(uhdr_dec_probe(d));
  if (valid) valid = ok(uhdr_decode(d));
  uhdr_release_decoder(d); return valid ? 1 : 0;
}
EMSCRIPTEN_KEEPALIVE unsigned char* lm_reencode(void* p, int n, int quality) {
  output.clear(); auto d = uhdr_create_decoder(); auto e = uhdr_create_encoder();
  auto image = input_image(p, n);
  bool valid = ok(uhdr_dec_set_image(d, &image)) && ok(uhdr_dec_probe(d));
  if (valid) valid = ok(uhdr_dec_set_out_img_format(d, UHDR_IMG_FMT_64bppRGBAHalfFloat)) &&
                     ok(uhdr_dec_set_out_color_transfer(d, UHDR_CT_LINEAR)) && ok(uhdr_decode(d));
  if (valid) valid = ok(uhdr_enc_set_raw_image(e, uhdr_get_decoded_image(d), UHDR_HDR_IMG));
  auto exif = valid ? uhdr_dec_get_exif(d) : nullptr;
  if (valid && exif && exif->data_sz) valid = ok(uhdr_enc_set_exif_data(e, exif));
  if (valid) valid = ok(uhdr_enc_set_quality(e, quality, UHDR_BASE_IMG)) &&
                     ok(uhdr_enc_set_quality(e, quality, UHDR_GAIN_MAP_IMG)) && ok(uhdr_encode(e));
  auto encoded = valid ? uhdr_get_encoded_stream(e) : nullptr;
  if (encoded) output.assign((unsigned char*)encoded->data, (unsigned char*)encoded->data + encoded->data_sz);
  uhdr_release_encoder(e); uhdr_release_decoder(d);
  return output.empty() ? nullptr : output.data();
}
EMSCRIPTEN_KEEPALIVE unsigned char* lm_fixture() {
  // Synthetic RGBA1010102 BT.2100 PQ image, no user data.
  const unsigned int w = 128, h = 128;
  std::vector<unsigned int> pixels(w*h);
  for (unsigned int y=0;y<h;y++) for(unsigned int x=0;x<w;x++)
    pixels[y*w+x] = (x*1023/w) | ((y*1023/h)<<10) | (800<<20) | (3u<<30);
  uhdr_raw_image_t image{}; image.fmt = UHDR_IMG_FMT_32bppRGBA1010102;
  image.cg = UHDR_CG_BT_2100; image.ct = UHDR_CT_PQ; image.range = UHDR_CR_FULL_RANGE;
  image.w = w; image.h = h; image.planes[0] = pixels.data(); image.stride[0] = w;
  auto e = uhdr_create_encoder(); output.clear();
  bool valid = ok(uhdr_enc_set_raw_image(e, &image, UHDR_HDR_IMG)) && ok(uhdr_encode(e));
  auto encoded = valid ? uhdr_get_encoded_stream(e) : nullptr;
  if(encoded) output.assign((unsigned char*)encoded->data, (unsigned char*)encoded->data+encoded->data_sz);
  uhdr_release_encoder(e); return output.empty()? nullptr : output.data();
}
}
