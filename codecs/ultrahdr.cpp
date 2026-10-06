// SPDX-License-Identifier: GPL-3.0-only
// Independent, minimal bridge to Google's public C API.
#include "ultrahdr_api.h"
#include <cstdio>
#include <cstdlib>
#include <csetjmp>
extern "C" {
#include "jpeglib.h"
}
#include <vector>
#include <cstring>
#include <string>
#include <cmath>
#include <cstdint>
#include <algorithm>
#include <emscripten/emscripten.h>
static std::vector<unsigned char> output;
static std::string last_error;
static bool ok(uhdr_error_info_t e) { if(e.error_code != UHDR_CODEC_OK) last_error = e.has_detail ? e.detail : "codec error"; return e.error_code == UHDR_CODEC_OK; }
static uhdr_compressed_image_t input_image(void* p, int n) {
  uhdr_compressed_image_t image{};
  image.data = p; image.data_sz = n; image.capacity = n;
  image.cg = UHDR_CG_UNSPECIFIED; image.ct = UHDR_CT_UNSPECIFIED;
  image.range = UHDR_CR_UNSPECIFIED;
  return image;
}
struct JpegJob {
  jpeg_decompress_struct decoder{}; jpeg_compress_struct encoder{};
  jpeg_error_mgr errors{}; jmp_buf jump;
  unsigned char* pixels=nullptr; unsigned char* encoded=nullptr; unsigned long encoded_size=0;
  bool decoder_created=false,encoder_created=false;
};
static void jpeg_failure(j_common_ptr info) {
  auto job=static_cast<JpegJob*>(info->client_data);char text[JMSG_LENGTH_MAX];
  info->err->format_message(info,text);last_error=text;longjmp(job->jump,1);
}
static void jpeg_message(j_common_ptr info,int level){if(level<0)jpeg_failure(info);}
static void jpeg_cleanup(JpegJob* job) {
  if(job->encoder_created)jpeg_destroy_compress(&job->encoder);
  if(job->decoder_created)jpeg_destroy_decompress(&job->decoder);
  free(job->pixels);free(job->encoded);delete job;
}
extern "C" {
// Full JPEG decoding and optional static reencode, using the pinned libjpeg-turbo
// already built for UltraHDR. No autorotation or implicit color-space conversion.
EMSCRIPTEN_KEEPALIVE unsigned char* lm_jpeg(void* p,int n,int quality) {
  output.clear();last_error.clear();auto job=new JpegJob;
  job->decoder.err=jpeg_std_error(&job->errors);job->errors.error_exit=jpeg_failure;job->errors.emit_message=jpeg_message;
  job->decoder.client_data=job;
  if(setjmp(job->jump)){jpeg_cleanup(job);return nullptr;}
  jpeg_create_decompress(&job->decoder);job->decoder_created=true;job->decoder.client_data=job;
  jpeg_mem_src(&job->decoder,static_cast<unsigned char*>(p),n);jpeg_read_header(&job->decoder,TRUE);
  auto& d=job->decoder;
  if(d.data_precision!=8||(d.num_components!=1&&d.num_components!=3)||d.image_width==0||d.image_height==0||
    uint64_t(d.image_width)*d.image_height>48000000){last_error="JPEG precision, components or pixel budget unsupported";jpeg_cleanup(job);return nullptr;}
  int h[3]={1,1,1},v[3]={1,1,1};for(int i=0;i<d.num_components;i++){h[i]=d.comp_info[i].h_samp_factor;v[i]=d.comp_info[i].v_samp_factor;}
  d.out_color_space=d.num_components==1?JCS_GRAYSCALE:JCS_RGB;
  jpeg_start_decompress(&d);size_t stride=size_t(d.output_width)*d.output_components;
  job->pixels=static_cast<unsigned char*>(malloc(stride*d.output_height));
  if(!job->pixels){last_error="JPEG allocation failed";jpeg_cleanup(job);return nullptr;}
  while(d.output_scanline<d.output_height){JSAMPROW row=job->pixels+stride*d.output_scanline;if(jpeg_read_scanlines(&d,&row,1)!=1){last_error="Incomplete JPEG scan";jpeg_cleanup(job);return nullptr;}}
  jpeg_finish_decompress(&d);
  if(quality==0){output.push_back(1);jpeg_cleanup(job);return output.data();}
  if(quality<1||quality>100){last_error="Invalid JPEG quality";jpeg_cleanup(job);return nullptr;}
  auto& e=job->encoder;e.err=&job->errors;e.client_data=job;jpeg_create_compress(&e);job->encoder_created=true;e.client_data=job;
  jpeg_mem_dest(&e,&job->encoded,&job->encoded_size);e.image_width=d.output_width;e.image_height=d.output_height;e.input_components=d.output_components;e.in_color_space=d.out_color_space;
  jpeg_set_defaults(&e);for(int i=0;i<e.num_components;i++){e.comp_info[i].h_samp_factor=h[i];e.comp_info[i].v_samp_factor=v[i];}
  jpeg_set_quality(&e,quality,TRUE);e.optimize_coding=TRUE;jpeg_start_compress(&e,TRUE);
  while(e.next_scanline<e.image_height){JSAMPROW row=job->pixels+stride*e.next_scanline;jpeg_write_scanlines(&e,&row,1);}
  jpeg_finish_compress(&e);output.assign(job->encoded,job->encoded+job->encoded_size);jpeg_cleanup(job);return output.empty()?nullptr:output.data();
}
EMSCRIPTEN_KEEPALIVE int lm_output_size() { return output.size(); }
EMSCRIPTEN_KEEPALIVE const char* lm_error() { return last_error.c_str(); }
EMSCRIPTEN_KEEPALIVE int lm_probe(void* p, int n) {
  auto d = uhdr_create_decoder(); auto image = input_image(p, n);
  bool valid = ok(uhdr_dec_set_image(d, &image)) && ok(uhdr_dec_probe(d));
  if (valid) valid = ok(uhdr_decode(d));
  uhdr_release_decoder(d); return valid ? 1 : 0;
}
static float half_value(uint16_t bits) {
  unsigned int sign=bits>>15,exponent=(bits>>10)&31,fraction=bits&1023;
  float value=exponent==0?std::ldexp(float(fraction),-24):exponent==31?INFINITY:std::ldexp(float(1024+fraction),int(exponent)-25);
  return sign?-value:value;
}
EMSCRIPTEN_KEEPALIVE double lm_compare(void* a,int an,void* b,int bn) {
  auto first=uhdr_create_decoder(),second=uhdr_create_decoder();auto ai=input_image(a,an),bi=input_image(b,bn);
  auto decode=[](auto* d,auto* image){return ok(uhdr_dec_set_image(d,image))&&ok(uhdr_dec_set_out_img_format(d,UHDR_IMG_FMT_64bppRGBAHalfFloat))&&ok(uhdr_dec_set_out_color_transfer(d,UHDR_CT_LINEAR))&&ok(uhdr_decode(d));};
  double result=-1;
  if(decode(first,&ai)&&decode(second,&bi)){
    const auto x=uhdr_get_decoded_image(first),y=uhdr_get_decoded_image(second);
    if(x->w==y->w&&x->h==y->h&&x->cg!=UHDR_CG_UNSPECIFIED&&x->cg==y->cg&&x->ct==y->ct){
      double error=0,energy=0;bool finite=true;
      for(unsigned int row=0;row<x->h;row++)for(unsigned int col=0;col<x->w;col++)for(unsigned int channel=0;channel<3;channel++){
        const auto xv=half_value(((uint16_t*)x->planes[0])[row*x->stride[0]*4+col*4+channel]);
        const auto yv=half_value(((uint16_t*)y->planes[0])[row*y->stride[0]*4+col*4+channel]);
        if(!std::isfinite(xv)||!std::isfinite(yv)){finite=false;continue;}
        error+=double(xv-yv)*(xv-yv);energy+=double(xv)*xv;
      }
      if(finite)result=std::sqrt(error/std::max(energy,1e-12));
    }
  }
  uhdr_release_decoder(first);uhdr_release_decoder(second);return result;
}
EMSCRIPTEN_KEEPALIVE unsigned char* lm_reencode(void* p, int n, int quality) {
  output.clear(); auto d = uhdr_create_decoder(); auto e = uhdr_create_encoder();
  auto image = input_image(p, n);
  bool valid = ok(uhdr_dec_set_image(d, &image)) &&
               ok(uhdr_dec_set_out_img_format(d, UHDR_IMG_FMT_64bppRGBAHalfFloat)) &&
               ok(uhdr_dec_set_out_color_transfer(d, UHDR_CT_LINEAR)) && ok(uhdr_decode(d));
  // The decoder returns packed RGB samples in full range, but leaves the descriptor range unspecified.
  // The encoder requires the range to be explicit for packed RGB input.
  if (valid) { auto raw = *uhdr_get_decoded_image(d); raw.range = UHDR_CR_FULL_RANGE;
              valid = ok(uhdr_enc_set_raw_image(e, &raw, UHDR_HDR_IMG)); }
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
