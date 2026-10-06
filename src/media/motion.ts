// SPDX-License-Identifier: GPL-3.0-only
import {ascii, concat, equal} from './bytes';
import {probe} from './probe';
import {xmpTags,namespaces,attr,cameraNamespace,itemNamespace} from './xmp';
export function replaceMotionVideo(original: Uint8Array, video: Uint8Array): Uint8Array {
  const p=probe(original);if(p.capability!=='motion'||!p.xmp||p.videoStart===undefined)throw new Error('Unsupported motion structure');
  const prefix=original.slice(0,p.videoStart);
  const start=p.xmp.payload+29,end=p.xmp.end;
  const xml=ascii(prefix,start,end-start);
  let changed=false;let next=xml;const tags=xmpTags(xml),ns=namespaces(tags);
  for(const tag of [...tags].reverse()){
    let raw=xml.slice(tag.start,tag.end);
    for(const key of tag.attrs.keys()){
      const [prefix,local]=key.split(':');const camera=ns.get(prefix!)===cameraNamespace&&['MicroVideoOffset','MotionPhotoOffset'].includes(local!);
      const item=ns.get(prefix!)===itemNamespace&&local==='Length'&&attr(tag,ns,itemNamespace,'Semantic')==='MotionPhoto';
      if(!camera&&!item)continue;changed=true;
      const escaped=key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      raw=raw.replace(new RegExp('('+escaped+'\\s*=\\s*["\'])\\d+(["\'])'),(_,a:string,z:string)=>a+video.length+z);
    }
    next=next.slice(0,tag.start)+raw+next.slice(tag.end);
  }
  if(!changed)throw new Error('No supported length field');
  const bytes=new TextEncoder().encode(next);
  if(bytes.length>end-start)throw new Error('XMP growth would require unverified MPF index rewrite');
  prefix.fill(32,start,end);prefix.set(bytes,start);
  const result=concat(prefix,video),after=probe(result);
  if(!after.live||after.videoStart!==prefix.length||after.timestamp!==p.timestamp||after.hdr!==p.hdr)throw new Error('Motion metadata readback failed');
  // Every byte outside the motion XMP payload, including gain map and MPF, is invariant.
  if(!equal(original.subarray(0,start),result.subarray(0,start))||!equal(original.subarray(end,p.videoStart),result.subarray(end,prefix.length)))throw new Error('Photo resources changed');
  return result;
}
