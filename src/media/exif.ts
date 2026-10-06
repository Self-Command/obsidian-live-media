// SPDX-License-Identifier: GPL-3.0-only
import {ascii,concat,jpegSegments} from './bytes';
interface Entry {tag:number;type:number;count:number;offset:number;start:number;end:number}
function tiff(b:Uint8Array,base:number,end:number){
  if(base+8>end)throw new Error('Truncated TIFF');
  const endian=ascii(b,base,2);if(!['II','MM'].includes(endian))throw new Error('Invalid TIFF endian');const le=endian==='II';
  const view=new DataView(b.buffer,b.byteOffset,b.byteLength);
  const u16=(p:number)=>{if(p<base||p+2>end)throw new Error('TIFF extent');return view.getUint16(p,le);};
  const u32=(p:number)=>{if(p<base||p+4>end)throw new Error('TIFF extent');return view.getUint32(p,le);};
  if(u16(base+2)!==42)throw new Error('Invalid TIFF magic');
  const widths:Record<number,number>={1:1,2:1,3:2,4:4,5:8,6:1,7:1,8:2,9:4,10:8,11:4,12:8};
  function entries(offset:number):Entry[]{const p=base+offset,n=u16(p);if(n>4096||p+2+n*12+4>end)throw new Error('Invalid IFD');
    return Array.from({length:n},(_,i)=>{const pos=p+2+i*12,tag=u16(pos),type=u16(pos+2),count=u32(pos+4),size=(widths[type]??0)*count;
      if(!widths[type]||size>1048576)throw new Error('Unknown/oversized TIFF value');const offset=u32(pos+8);const start=size<=4?pos+8:base+offset;
      if(start<base||start+size>end)throw new Error('TIFF value outside segment');return {tag,type,count,offset,start,end:start+size};});}
  return {u16,u32,entries,le,view,first:u32(base+4)};
}
export function exifOrientation(input:Uint8Array):number{
  const s=jpegSegments(input).find(s=>s.marker===0xe1&&ascii(input,s.payload,6)==='Exif\0\0');if(!s)return 1;
  const t=tiff(input,s.payload+6,s.end);const entry=t.entries(t.first).find(e=>e.tag===0x112);return entry?t.u16(entry.start):1;
}
function app1(payload:Uint8Array):Uint8Array{if(payload.length>65533)throw new Error('APP1 too large');const result=new Uint8Array(payload.length+4);result.set([255,225]);new DataView(result.buffer).setUint16(2,payload.length+2);result.set(payload,4);return result;}
export function minimalExif(orientation:number):Uint8Array{
  if(orientation<1||orientation>8)throw new Error('Invalid orientation');
  const data=new Uint8Array(26),v=new DataView(data.buffer);data.set([0x49,0x49]);v.setUint16(2,42,true);v.setUint32(4,8,true);v.setUint16(8,1,true);v.setUint16(10,0x112,true);v.setUint16(12,3,true);v.setUint32(14,1,true);v.setUint16(18,orientation,true);
  return app1(concat(new TextEncoder().encode('Exif\0\0'),data));
}
export function scrubGpsSegment(segment:Uint8Array):Uint8Array{
  const b=segment.slice();if(ascii(b,4,6)!=='Exif\0\0')throw new Error('Not EXIF');const base=10,t=tiff(b,base,b.length);
  const main=t.entries(t.first);const gps=main.find(e=>e.tag===0x8825);if(!gps)return b;
  const gpsEntries=t.entries(gps.offset);const gpsStart=base+gps.offset,gpsEnd=gpsStart+2+gpsEntries.length*12+4;
  const ranges=gpsEntries.filter(e=>e.end-e.start>4).map(e=>[e.start,e.end]);ranges.push([gpsStart,gpsEnd]);
  const exif=main.find(e=>e.tag===0x8769),other=[...main,...(exif?t.entries(exif.offset):[])].filter(e=>e!==gps);
  if(other.some(e=>ranges.some(([start,end])=>e.start<end!&&e.end>start!)))throw new Error('Shared EXIF extent protected');
  for(const [start,end]of ranges)b.fill(0,start,end);
  t.view.setUint32(gps.start,0,t.le);return b;
}
export function applePhotoId(input:Uint8Array):string|undefined{
  // Trusted Apple pairing requires MakerApple key 17; do not infer it from filenames.
  const s=jpegSegments(input).find(s=>s.marker===0xe1&&ascii(input,s.payload,6)==='Exif\0\0');if(!s)return;
  const t=tiff(input,s.payload+6,s.end),exif=t.entries(t.first).find(e=>e.tag===0x8769);if(!exif)return;
  const maker=t.entries(exif.offset).find(e=>e.tag===0x927c);if(!maker)return;
  const start=maker.start;if(ascii(input,start,10)!=='Apple iOS\0')return;
  // Apple maker notes are big endian and offsets are relative to the maker-note start.
  const view=new DataView(input.buffer,input.byteOffset,input.byteLength),p=start+14;
  if(p+2>maker.end)throw new Error('Truncated Apple maker note');const count=view.getUint16(p,false);
  if(count>1024||p+2+count*12>maker.end)throw new Error('Invalid Apple maker note');
  for(let i=0;i<count;i++){
    const e=p+2+i*12;if(view.getUint16(e,false)!==17)continue;
    const type=view.getUint16(e+2,false),n=view.getUint32(e+4,false);if(type!==2||n<2||n>128)throw new Error('Invalid Apple identity value');
    const at=n<=4?e+8:start+view.getUint32(e+8,false);if(at+n>maker.end)throw new Error('Apple identity extent');
    const id=ascii(input,at,n).replace(/\0+$/,'');if(!/^[\w-]{8,128}$/.test(id))throw new Error('Malformed Apple identity');return id;
  }
}
