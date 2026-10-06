// SPDX-License-Identifier: GPL-3.0-only
import {OfflineEngine} from '../engine/client';
import {probe, type MediaProbe} from '../media/probe';
import {replaceMotionVideo} from '../media/motion';
import {validateVideoPreservation,validateCoverTime} from '../media/mp4';
import {ascii, concat, equal, jpegSegments} from '../media/bytes';
import type {Config} from '../settings/model';
import {exifOrientation,minimalExif,scrubGpsSegment,applePhotoId} from '../media/exif';
import {mpfPictures,addMotionToHdr,addMotionToSdr} from '../media/hdr';
import {xmpTags,namespaces,cameraNamespace,itemNamespace} from '../media/xmp';
import {trustedApplePair,validateAppleMovie} from '../media/apple';
export interface Encoded {bytes: Uint8Array; before: MediaProbe; after: MediaProbe; backend: string; warnings: string[]}
export class ProtectedMedia extends Error {}
export class Compressor {
  constructor(public engine: OfflineEngine,private native?:()=>OfflineEngine|undefined){}
  async encode(input:Uint8Array,extension:string,c:Config,signal:AbortSignal,intermediate=false):Promise<Encoded>{
    const before=probe(input);const warnings:string[]=[];
    if(input.length>Number(c['performance.maxInputMiB'])*1048576)throw new ProtectedMedia('Input exceeds configured memory budget');
    if(before.width&&before.height&&before.width*before.height>Number(c['performance.maxPixelsMp'])*1000000)throw new ProtectedMedia('Pixel budget exceeded');
    const hdrPhoto=before.hdr&&before.format==='jpeg';
    if(hdrPhoto&&before.protected.some(reason=>!['Unclassified appended resources','HDR requires verified reconstruction'].includes(reason)))throw new ProtectedMedia(before.protected.join('; '));
    if(!hdrPhoto&&(before.protected.length||before.capability==='protected'))throw new ProtectedMedia(before.protected.join('; ')||'No verified writer');
    const format=before.live?'motion-jpeg':before.format;
    if((c['compression.formats'] as Record<string,boolean>)[format]===false)throw new ProtectedMedia('Format disabled');
    if(c['compression.backend']==='webcodecs')throw new ProtectedMedia('WebCodecs preservation route has not passed protection gate');
    const backend=c['compression.backend']==='native'?this.native?.():this.engine;
    if(!backend)throw new ProtectedMedia('Native backend not authorized on this device');
    if(!['jpg','jpeg','png','webp'].includes(extension.toLowerCase()))throw new ProtectedMedia('Extension and writer mismatch');
    const cancel=()=>backend.destroy();signal.addEventListener('abort',cancel,{once:true});
    try{
      if(signal.aborted)throw new Error('Cancelled');
      let bytes:Uint8Array;
      if(before.live){
        if(before.videoStart===undefined)throw new ProtectedMedia('No trusted video boundary');
        if(c['compression.liveMode']==='video-only'&&(!c['compression.preserveExif']||!c['compression.preserveGps']))throw new ProtectedMedia('Video-only preserves the photo unchanged; metadata removal requires a photo route');
        const video=input.slice(before.videoStart);
        validateCoverTime(video,before.timestamp);
        await backend.validate(video);
        const lossless=c['compression.preset']==='lossless'||!c['compression.allowLossy'];
        const args=['-v','error','-noautorotate','-i','$INPUT','-map','0','-map_metadata','0'];
        if(lossless)args.push('-c','copy');
        else{
          const crf=c['compression.videoQuality']==='high'?18:c['compression.videoQuality']==='balanced'?23:Number(c['compression.ffmpegCrf']);
          args.push('-c','copy','-c:v','libx264','-crf',String(crf),'-preset',c['performance.encodePriority']==='low'?'veryfast':'medium','-fps_mode','passthrough','-enc_time_base:v','-1');
          if(c['compression.resizeVideo'])args.push('-vf',`scale='min(${c['compression.maxVideoEdge']},iw)':'min(${c['compression.maxVideoEdge']},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`);
        }
        args.push('-movflags','+faststart','$OUTPUT');
        const output=c['compression.liveMode']==='photo-only'?video:await backend.encode(video,'mp4',args);
        await backend.validate(output);
        await validateVideoPreservation(video,output,!!c['compression.resizeVideo']);
        if(c['compression.liveMode']==='video-only')bytes=replaceMotionVideo(input,output);
        else {
          if(lossless)throw new ProtectedMedia('Photo reencode is not a lossless route');
          if(before.hdr){
            if(c['compression.resizeImage']||!c['compression.preserveExif']||!c['compression.preserveGps'])throw new ProtectedMedia('HDR resize/privacy metadata writer not verified');
            const photo=input.slice(0,before.videoStart);if(mpfPictures(photo).pictures.at(-1)!.end!==photo.length)throw new ProtectedMedia('Unclassified HDR trailing bytes');
            if(await this.engine.run('hdr-probe',{input:photo})!==1)throw new ProtectedMedia('HDR full decode failed');
            const rebuilt=await this.engine.run('hdr-reencode',{input:photo,quality:Number(c['compression.jpegQuality'])})as Uint8Array;
            if(await this.engine.run('hdr-probe',{input:rebuilt})!==1)throw new Error('Rebuilt HDR failed full decode');
            bytes=addMotionToHdr(rebuilt,output,before.timestamp);
            if(await this.engine.run('hdr-probe',{input:bytes.slice(0,probe(bytes).videoStart)})!==1)throw new Error('Final gain-map decode failed');
          }else{
            const s=before.xmp!;const xml=ascii(input,s.payload+29,s.end-s.payload-29),tags=xmpTags(xml),ns=namespaces(tags);
            for(const tag of tags)for(const [key,value]of tag.attrs){
              if(key.startsWith('xmlns:')||['rdf:parseType','x:xmptk'].includes(key))continue;
              const [prefix,local]=key.split(':');const uri=ns.get(prefix!);
              if(uri===cameraNamespace&&['MotionPhoto','MotionPhotoVersion','MotionPhotoPresentationTimestampUs','MicroVideo','MicroVideoVersion','MicroVideoOffset','MicroVideoPresentationTimestampUs'].includes(local!))continue;
              if(uri===itemNamespace&&['Mime','Semantic','Length','Padding'].includes(local!))continue;
              throw new ProtectedMedia('Motion packet contains ancillary metadata needing preservation: '+key);
            }
            if(jpegSegments(input).at(-1)!.end!==before.videoStart)throw new ProtectedMedia('Unclassified SDR resources between image and movie');
            const photo=concat(input.subarray(0,s.start),input.subarray(s.end,before.videoStart));
            const rebuilt=await this.encode(photo,extension,c,signal,true);
            bytes=addMotionToSdr(rebuilt.bytes,output,before.timestamp);
          }
        }
        // Static pixel codestream, EXIF, MPF, gain map and timestamps are preserved by writer.
        warnings.push(c['compression.liveMode']==='video-only'?'Static image resources preserved byte for byte outside motion length XMP.':before.hdr?'HDR intents reencoded with new verified MPF index; original cover time retained.':'JPEG reencoded with retained metadata; original cover time retained.');
      }else{
        if(before.hdr){
          if(c['compression.preset']==='lossless'||!c['compression.allowLossy'])throw new ProtectedMedia('HDR reconstruction is lossy');
          if(c['compression.resizeImage']||!c['compression.preserveExif']||!c['compression.preserveGps'])throw new ProtectedMedia('HDR resize/privacy metadata writer not verified');
          if(mpfPictures(input).pictures.at(-1)!.end!==input.length)throw new ProtectedMedia('Unclassified HDR trailing bytes');
          if(await this.engine.run('hdr-probe',{input})!==1)throw new ProtectedMedia('HDR full decode failed');
          bytes=await this.engine.run('hdr-reencode',{input,quality:Number(c['compression.jpegQuality'])})as Uint8Array;
          mpfPictures(bytes);if(await this.engine.run('hdr-probe',{input:bytes})!==1)throw new Error('Reconstructed HDR full decode failed');
        }else if(before.format==='jpeg'){
          if(c['compression.preset']==='lossless'||!c['compression.allowLossy'])
            throw new ProtectedMedia('No verified lossless JPEG optimizer; choose explicit reencode');
          if(c['compression.staticStrategy']==='lossless-first')warnings.push('No lossless JPEG saving route; explicit allowLossy permits JPEG reencode.');
          const segments=jpegSegments(input);
          const metadata=segments.filter(s=>s.marker>=0xe0&&s.marker<=0xef&&s.marker!==0xe0);
          if(applePhotoId(input))throw new ProtectedMedia('Apple paired photo must be processed as a verified media group');
          if(metadata.some(s=>ascii(input,s.payload,4)==='MPF\0'))throw new ProtectedMedia('Multi-picture JPEG protected');
          const quality=Number(c['compression.jpegQuality']);
          const args=['-v','error','-noautorotate','-i','$INPUT','-frames:v','1','-q:v',String(Math.max(2,Math.round(31-(quality-50)*29/50)))];
          if(c['compression.resizeImage'])args.push('-vf',`scale='min(${c['compression.maxImageEdge']},iw)':'min(${c['compression.maxImageEdge']},ih)':force_original_aspect_ratio=decrease`);
          args.push('$OUTPUT');bytes=await backend.encode(input,extension,args);
          const keep=metadata.flatMap(s=>{
            if(s.marker===0xe1&&ascii(input,s.payload,6)==='Exif\0\0'){
              if(!c['compression.preserveExif'])return [minimalExif(exifOrientation(input))];
              if(!c['compression.preserveGps'])return [scrubGpsSegment(input.slice(s.start,s.end))];
              if(c['compression.resizeImage'])throw new ProtectedMedia('EXIF dimensions need explicit metadata writer before resize');
            }
            if(!c['compression.preserveGps']&&s.marker===0xe1&&/GPS|Location/i.test(ascii(input,s.payload,s.end-s.payload)))throw new ProtectedMedia('Location-bearing XMP protected');
            return [input.slice(s.start,s.end)];
          });
          const encodedSegments=jpegSegments(bytes);
          const encodedMetadata=encodedSegments.filter(s=>s.marker>=0xe0&&s.marker<=0xef);
          const chunks:Uint8Array[]=[];let position=0;
          for(const segment of encodedMetadata){chunks.push(bytes.slice(position,segment.start));position=segment.end;}
          chunks.push(bytes.slice(position));const cleaned=concat(...chunks);
          bytes=concat(cleaned.subarray(0,2),...keep,cleaned.subarray(2));
        }else if(before.format==='png'){
          if(c['compression.pngMode']==='skip')throw new ProtectedMedia('PNG disabled');
          if(c['compression.resizeImage'])throw new ProtectedMedia('PNG resize requires pixel/metadata validation');
          bytes=await backend.encode(input,'png',['-v','error','-i','$INPUT','-frames:v','1','-compression_level','9','$OUTPUT']);
          // Both files decode to identical RGBA; protects alpha and color for supported 8-bit PNG.
          const rawArgs=['-v','error','-i','$INPUT','-frames:v','1','-f','rawvideo','-pix_fmt','rgba','$OUTPUT'];
          const originalPixels=await backend.encode(input,'png',rawArgs,'raw');
          const newPixels=await backend.encode(bytes,'png',rawArgs,'raw');
          if(!equal(originalPixels,newPixels))throw new ProtectedMedia('PNG pixel/alpha mismatch');
          if(input[24]!==8)throw new ProtectedMedia('Only validated 8-bit PNG path');
        }else if(before.format==='webp'){
          if(c['compression.resizeImage'])throw new ProtectedMedia('WebP resize is not verified');
          const lossless=c['compression.staticStrategy']==='lossless-first'||c['compression.preset']==='lossless'||!c['compression.allowLossy'];
          bytes=await backend.encode(input,'webp',['-v','error','-i','$INPUT','-frames:v','1','-c:v','libwebp','-lossless',lossless?'1':'0','-quality',String(c['compression.webpQuality']),'$OUTPUT']);
          if(lossless){const raw=['-v','error','-i','$INPUT','-f','rawvideo','-pix_fmt','rgba','$OUTPUT'];
            if(!equal(await backend.encode(input,'webp',raw,'raw'),await backend.encode(bytes,'webp',raw,'raw')))throw new ProtectedMedia('WebP lossless pixel mismatch');}
        }else throw new ProtectedMedia('No validated writer');
        await backend.validate(bytes);
      }
      if(signal.aborted)throw new Error('Cancelled');
      const after=probe(bytes);
      if(after.format!==before.format||after.live!==before.live||after.hdr!==before.hdr)throw new Error('Output capability changed');
      if(!c['compression.resizeImage']&&(before.width!==after.width||before.height!==after.height))throw new Error('Image dimensions changed');
      if(!intermediate&&((1-bytes.length/input.length)*100<Number(c['compression.minSavingPercent'])||bytes.length>=input.length))throw new ProtectedMedia('Result does not meet minimum savings');
      return {bytes,before,after,backend:c['compression.backend']==='native'?'native':'wasm',warnings};
    }finally{signal.removeEventListener('abort',cancel);}
  }
  async encodeApple(photo:Uint8Array,movie:Uint8Array,c:Config,signal:AbortSignal):Promise<{photo:Uint8Array;movie:Uint8Array}>{
    if(!trustedApplePair(photo,movie))throw new ProtectedMedia('Apple pair identity or still-image-time track is missing');
    if(c['compression.resizeVideo']||c['compression.resizeImage'])throw new ProtectedMedia('Apple resizing requires verified orientation and crop handling');
    if(!c['compression.preserveExif']||!c['compression.preserveGps'])throw new ProtectedMedia('Apple identity metadata cannot be stripped by this route');
    if(c['compression.liveMode']!=='video-only')throw new ProtectedMedia('Apple photo reencode has not passed maker-note/phone protection tests');
    if(movie.length>Number(c['performance.maxInputMiB'])*1048576)throw new ProtectedMedia('Apple movie exceeds input budget');
    const backend=c['compression.backend']==='native'?this.native?.():this.engine;if(!backend||c['compression.backend']==='webcodecs')throw new ProtectedMedia('Selected backend unavailable');
    const cancel=()=>backend.destroy();signal.addEventListener('abort',cancel,{once:true});
    try{
      if(signal.aborted)throw new Error('Cancelled');await backend.validate(movie);
      const args=['-v','error','-noautorotate','-i','$INPUT','-map','0','-map_metadata','0','-c','copy'];
      if(c['compression.allowLossy']&&c['compression.preset']!=='lossless'){
        const crf=c['compression.videoQuality']==='high'?18:c['compression.videoQuality']==='balanced'?23:Number(c['compression.ffmpegCrf']);
        args.push('-c:v','libx264','-crf',String(crf),'-fps_mode','passthrough','-enc_time_base:v','-1');
      }
      args.push('-movflags','use_metadata_tags','$OUTPUT');const output=await backend.encode(movie,'mov',args);
      await backend.validate(output);await validateAppleMovie(movie,output);
      if(!trustedApplePair(photo,output))throw new Error('Output Apple pair no longer trusted');
      if(output.length>=movie.length||(1-output.length/movie.length)*100<Number(c['compression.minSavingPercent']))throw new ProtectedMedia('Apple movie does not meet savings threshold');
      return {photo:photo.slice(),movie:output};
    }finally{signal.removeEventListener('abort',cancel);}
  }
}
