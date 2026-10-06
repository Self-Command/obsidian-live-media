// SPDX-License-Identifier: GPL-3.0-only
import {OfflineEngine} from '../engine/client';
import {probe, type MediaProbe} from '../media/probe';
import {replaceMotionVideo} from '../media/motion';
import {validateVideoPreservation} from '../media/mp4';
import {ascii, concat, equal, jpegSegments} from '../media/bytes';
import type {Config} from '../settings/model';
export interface Encoded {bytes: Uint8Array; before: MediaProbe; after: MediaProbe; backend: string; warnings: string[]}
export class ProtectedMedia extends Error {}
export class Compressor {
  constructor(public engine: OfflineEngine){}
  async encode(input:Uint8Array,extension:string,c:Config,signal:AbortSignal):Promise<Encoded>{
    const before=probe(input);const warnings:string[]=[];
    if(input.length>Number(c['performance.maxInputMiB'])*1048576)throw new ProtectedMedia('Input exceeds configured memory budget');
    if(before.width&&before.height&&before.width*before.height>Number(c['performance.maxPixelsMp'])*1000000)throw new ProtectedMedia('Pixel budget exceeded');
    if(before.protected.length||before.capability==='protected')throw new ProtectedMedia(before.protected.join('; ')||'No verified writer');
    const format=before.live?'motion-jpeg':before.format;
    if((c['compression.formats'] as Record<string,boolean>)[format]===false)throw new ProtectedMedia('Format disabled');
    if(c['compression.backend']==='webcodecs'||c['compression.backend']==='native')throw new ProtectedMedia('Selected backend has not passed protection gate');
    if(!['jpg','jpeg','png','webp'].includes(extension.toLowerCase()))throw new ProtectedMedia('Extension and writer mismatch');
    const cancel=()=>this.engine.destroy();signal.addEventListener('abort',cancel,{once:true});
    try{
      if(signal.aborted)throw new Error('Cancelled');
      let bytes:Uint8Array;
      if(before.live){
        if(before.videoStart===undefined)throw new ProtectedMedia('No trusted video boundary');
        if(c['compression.liveMode']!=='video-only')throw new ProtectedMedia('Photo-only and dual rewrite require verified gain-map/index writer');
        const video=input.slice(before.videoStart);
        await this.engine.validate(video);
        const lossless=c['compression.preset']==='lossless'||!c['compression.allowLossy'];
        const args=['-v','error','-noautorotate','-i','$INPUT','-map','0','-map_metadata','0'];
        if(lossless)args.push('-c','copy');
        else{
          args.push('-c','copy','-c:v','libx264','-crf',String(c['compression.ffmpegCrf']),'-preset',c['performance.encodePriority']==='low'?'veryfast':'medium','-fps_mode','passthrough','-enc_time_base:v','demux');
          if(c['compression.resizeVideo'])args.push('-vf',`scale='min(${c['compression.maxVideoEdge']},iw)':'min(${c['compression.maxVideoEdge']},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`);
        }
        args.push('-movflags','+faststart','$OUTPUT');
        const output=await this.engine.encode(video,'mp4',args);
        await this.engine.validate(output);
        await validateVideoPreservation(video,output,!!c['compression.resizeVideo']);
        bytes=replaceMotionVideo(input,output);
        // Static pixel codestream, EXIF, MPF, gain map and timestamps are preserved by writer.
        warnings.push('Static image resources preserved byte for byte outside motion length XMP.');
      }else{
        if(before.hdr)throw new ProtectedMedia('HDR reconstruction writer not yet verified');
        if(before.format==='jpeg'){
          if(c['compression.preset']==='lossless'||!c['compression.allowLossy']||c['compression.staticStrategy']==='lossless-first')
            throw new ProtectedMedia('No verified lossless JPEG optimizer; choose explicit reencode');
          const segments=jpegSegments(input);
          const metadata=segments.filter(s=>s.marker>=0xe0&&s.marker<=0xef&&s.marker!==0xe0);
          if(metadata.some(s=>ascii(input,s.payload,4)==='MPF\0'))throw new ProtectedMedia('Multi-picture JPEG protected');
          const quality=Number(c['compression.jpegQuality']);
          const args=['-v','error','-noautorotate','-i','$INPUT','-frames:v','1','-q:v',String(Math.max(2,Math.round(31-(quality-50)*29/50)))];
          if(c['compression.resizeImage'])args.push('-vf',`scale='min(${c['compression.maxImageEdge']},iw)':'min(${c['compression.maxImageEdge']},ih)':force_original_aspect_ratio=decrease`);
          args.push('$OUTPUT');bytes=await this.engine.encode(input,extension,args);
          const keep=metadata.filter(s=>{
            if(s.marker===0xe1&&ascii(input,s.payload,6)==='Exif\0\0'){
              if(!c['compression.preserveExif'])throw new ProtectedMedia('EXIF removal requires orientation-aware metadata writer');
              if(!c['compression.preserveGps'])throw new ProtectedMedia('GPS removal requires verified EXIF writer');
            }return true;
          }).map(s=>input.slice(s.start,s.end));
          const encodedSegments=jpegSegments(bytes);
          const encodedMetadata=encodedSegments.filter(s=>s.marker>=0xe0&&s.marker<=0xef);
          const chunks:Uint8Array[]=[];let position=0;
          for(const segment of encodedMetadata){chunks.push(bytes.slice(position,segment.start));position=segment.end;}
          chunks.push(bytes.slice(position));const cleaned=concat(...chunks);
          bytes=concat(cleaned.subarray(0,2),...keep,cleaned.subarray(2));
        }else if(before.format==='png'){
          if(c['compression.pngMode']==='skip')throw new ProtectedMedia('PNG disabled');
          if(c['compression.resizeImage'])throw new ProtectedMedia('PNG resize requires pixel/metadata validation');
          bytes=await this.engine.encode(input,'png',['-v','error','-i','$INPUT','-frames:v','1','-compression_level','9','$OUTPUT']);
          // Both files decode to identical RGBA; protects alpha and color for supported 8-bit PNG.
          const rawArgs=['-v','error','-i','$INPUT','-frames:v','1','-f','rawvideo','-pix_fmt','rgba','$OUTPUT'];
          const originalPixels=await this.engine.encode(input,'png',rawArgs,'raw');
          const newPixels=await this.engine.encode(bytes,'png',rawArgs,'raw');
          if(!equal(originalPixels,newPixels))throw new ProtectedMedia('PNG pixel/alpha mismatch');
          if(input[24]!==8)throw new ProtectedMedia('Only validated 8-bit PNG path');
        }else if(before.format==='webp'){
          if(c['compression.resizeImage'])throw new ProtectedMedia('WebP resize is not verified');
          const lossless=c['compression.staticStrategy']==='lossless-first'||c['compression.preset']==='lossless'||!c['compression.allowLossy'];
          bytes=await this.engine.encode(input,'webp',['-v','error','-i','$INPUT','-frames:v','1','-c:v','libwebp','-lossless',lossless?'1':'0','-quality',String(c['compression.webpQuality']),'$OUTPUT']);
          if(lossless){const raw=['-v','error','-i','$INPUT','-f','rawvideo','-pix_fmt','rgba','$OUTPUT'];
            if(!equal(await this.engine.encode(input,'webp',raw,'raw'),await this.engine.encode(bytes,'webp',raw,'raw')))throw new ProtectedMedia('WebP lossless pixel mismatch');}
        }else throw new ProtectedMedia('No validated writer');
        await this.engine.validate(bytes);
      }
      if(signal.aborted)throw new Error('Cancelled');
      const after=probe(bytes);
      if(after.format!==before.format||after.live!==before.live||after.hdr!==before.hdr)throw new Error('Output capability changed');
      if(!c['compression.resizeImage']&&(before.width!==after.width||before.height!==after.height))throw new Error('Image dimensions changed');
      if((1-bytes.length/input.length)*100<Number(c['compression.minSavingPercent'])||bytes.length>=input.length)throw new ProtectedMedia('Result does not meet minimum savings');
      return {bytes,before,after,backend:'wasm',warnings};
    }finally{signal.removeEventListener('abort',cancel);}
  }
}
