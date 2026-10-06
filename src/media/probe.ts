// SPDX-License-Identifier: GPL-3.0-only
import {ascii, boxes, jpegSegments, u16, u32, type JpegSegment} from './bytes';
import {xmpTags,namespaces,attr,cameraNamespace,itemNamespace} from './xmp';
export interface MediaProbe {
  format: string; live: boolean; hdr: boolean; width?: number; height?: number;
  videoStart?: number; photoEnd?: number; timestamp?: string; xmp?: JpegSegment;
  protected: string[]; capability: 'static' | 'motion' | 'play-only' | 'protected';
}
export function probe(b: Uint8Array): MediaProbe {
  const result: MediaProbe={format:'unknown',live:false,hdr:false,protected:[],capability:'protected'};
  try {
    if(b[0]===255&&b[1]===216){
      result.format='jpeg'; const segs=jpegSegments(b);
      const eoi=segs.find(s=>s.marker===0xd9)!.end;
      const frame=segs.find(s=>[0xc0,0xc1,0xc2].includes(s.marker));
      if(frame){result.height=u16(b,frame.payload+1);result.width=u16(b,frame.payload+3);
        if(b[frame.payload]!==8||![1,3].includes(b[frame.payload+5]!))result.protected.push('Unverified JPEG precision or color components');}
      const xmps=segs.filter(s=>s.marker===0xe1&&ascii(b,s.payload,29).startsWith('http://ns.adobe.com/xap/1.0/'));
      const all=segs.filter(s=>s.marker>=0xe0&&s.marker<=0xef).map(s=>ascii(b,s.payload,s.end-s.payload)).join('');
      result.hdr=/hdrgm:|hdr-gain-map|urn:iso:std:iso:ts:21496|HDRGainMap/.test(all)||segs.some(s=>s.marker===0xe2&&ascii(b,s.payload,4)==='MPF\0');
      if(!result.hdr&&segs.some(s=>s.marker===0xe2&&ascii(b,s.payload,11)==='ICC_PROFILE'))result.protected.push('ICC JPEG reencode is not color-validated');
      for(const s of xmps){
        const xml=ascii(b,s.payload+29,s.end-s.payload-29);
        const tags=xmpTags(xml),ns=namespaces(tags);
        const values=(name:string)=>tags.map(t=>attr(t,ns,cameraNamespace,name)).filter((v):v is string=>v!==undefined);
        const isMotion=values('MotionPhoto').includes('1')||values('MicroVideo').includes('1');
        if(!isMotion)continue;
        if(result.xmp)throw new Error('Multiple motion XMP packets');
        result.xmp=s;
        let length: number | undefined;
        const offsets=[...values('MicroVideoOffset'),...values('MotionPhotoOffset')];
        if(offsets.length>1&&new Set(offsets).size>1)throw new Error('Conflicting offsets');
        if(offsets[0]){if(!/^\d+$/.test(offsets[0]))throw new Error('Invalid offset');length=Number(offsets[0]);}
        const motion=tags.filter(t=>attr(t,ns,itemNamespace,'Semantic')==='MotionPhoto');
        if(motion.length>1)throw new Error('Multiple motion items');
        if(motion[0]){
          const len=attr(motion[0],ns,itemNamespace,'Length');if(!len||!/^\d+$/.test(len))throw new Error('Missing motion item length');
          if(length!==undefined&&length!==Number(len))throw new Error('Conflicting motion offsets');
          length=Number(len);
          if(attr(motion[0],ns,itemNamespace,'Mime')!=='video/mp4')throw new Error('Unsupported motion MIME');
        }
        if(!length||!Number.isSafeInteger(length)||length>b.length-eoi)throw new Error('Invalid motion length');
        const start=b.length-length;
        const videoBoxes=boxes(b,start,b.length);
        if(videoBoxes[0]?.type!=='ftyp'||!videoBoxes.some(s=>s.type==='moov')||!videoBoxes.some(s=>s.type==='mdat'))throw new Error('Incomplete motion MP4');
        result.live=true;result.videoStart=start;result.photoEnd=start;
        const time=[...values('MotionPhotoPresentationTimestampUs'),...values('MicroVideoPresentationTimestampUs')];
        if(time.length>1&&new Set(time).size>1)throw new Error('Conflicting cover time');
        if(time[0]&&!/^-?\d{1,20}$/.test(time[0]))throw new Error('Invalid cover time');result.timestamp=time[0];
      }
      if(result.live)result.capability='motion';
      else if(eoi===b.length)result.capability=result.hdr?'protected':'static';
      else result.protected.push('Unclassified appended resources');
      // Maker notes / proprietary HDR are readable, but are never casually reencoded.
      if(result.hdr&&!result.live)result.protected.push('HDR requires verified reconstruction');
      return result;
    }
    if(ascii(b,1,3)==='PNG'&&b[0]===137){
      result.format='png';result.width=u32(b,16);result.height=u32(b,20);result.capability='static';
      let p=8;let hasEnd=false;
      while(p+12<=b.length){const n=u32(b,p),name=ascii(b,p+4,4);if(p+n+12>b.length)throw new Error('Truncated PNG');
        if(name==='acTL')result.protected.push('Animated PNG');
        if(['iCCP','cICP','mDCv','cLLi'].includes(name)){result.protected.push('Color-managed PNG');result.hdr=true;}
        if(!['IHDR','PLTE','IDAT','IEND','tRNS','pHYs','tEXt','zTXt','iTXt','tIME'].includes(name))result.protected.push('PNG ancillary chunk requires a verified preservation writer: '+name);
        if(name==='IEND'){hasEnd=true;if(p+n+12!==b.length)result.protected.push('PNG trailing data');break;}p+=n+12;}
      if(!hasEnd)throw new Error('Missing PNG IEND');
    } else if(ascii(b,0,4)==='RIFF'&&ascii(b,8,4)==='WEBP'){
      result.format='webp'; result.capability='static';
      if(u32le(b,4)+8!==b.length)throw new Error('Invalid RIFF length');
      for(let p=12;p+8<=b.length;){const n=u32le(b,p+4),name=ascii(b,p,4);if(p+8+n>b.length)throw new Error('Truncated WEBP');
        if(['ANIM','ANMF','ICCP','EXIF','XMP '].includes(name))result.protected.push('WebP animation or protected metadata: '+name);
        p+=8+n+(n%2);}
    } else if(ascii(b,0,3)==='GIF'){result.format='gif';result.protected.push('Animation preserved; no verified recompressor');}
    else if(ascii(b,4,4)==='ftyp'){result.format='isobmff';result.protected.push('HEIF/AVIF requires a verified image-container writer');}
    else result.protected.push('No verified writer for this format');
    if(result.protected.length)result.capability='protected';
    return result;
  }catch(e){result.protected.push(String(e));result.capability='protected';return result;}
}
function u32le(b:Uint8Array,p:number):number {return new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(p,true);}
