// SPDX-License-Identifier: GPL-3.0-only
export function u16(b: Uint8Array, p: number): number {if (p < 0 || p+2>b.length) throw new Error('Truncated uint16'); return new DataView(b.buffer,b.byteOffset,b.byteLength).getUint16(p);}
export function u32(b: Uint8Array, p: number): number {if (p < 0 || p+4>b.length) throw new Error('Truncated uint32'); return new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(p);}
export function u64(b: Uint8Array, p: number): number {const n = (BigInt(u32(b,p))<<32n)+BigInt(u32(b,p+4)); if(n>BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Unsafe size'); return Number(n);}
export function ascii(b: Uint8Array, a=0, n=b.length-a): string {return new TextDecoder().decode(b.subarray(a,a+n));}
export function concat(...bs: Uint8Array[]): Uint8Array {const b = new Uint8Array(bs.reduce((n,v)=>n+v.length,0)); let p=0; for(const v of bs){b.set(v,p);p+=v.length;}return b;}
export function equal(a: Uint8Array,b: Uint8Array): boolean {return a.length===b.length&&a.every((n,i)=>n===b[i]);}
export async function hash(b: Uint8Array): Promise<string> {const h=await crypto.subtle.digest('SHA-256',b.slice().buffer);return Array.from(new Uint8Array(h),v=>v.toString(16).padStart(2,'0')).join('');}
export interface JpegSegment {marker: number; start: number; end: number; payload: number}
export function jpegSegments(b: Uint8Array): JpegSegment[] {
  if (b[0]!==255||b[1]!==216) throw new Error('Not JPEG');
  const segments: JpegSegment[]=[]; let p=2; let scan=false;
  while(p<b.length) {
    if(scan){while(p<b.length&&b[p]!==255)p++;if(p>=b.length)break;}
    const start=p; if(b[p++]!==255)throw new Error('Invalid JPEG marker');
    while(b[p]===255)p++;
    const marker=b[p++]; if(marker===undefined)break;
    if(marker===0 || (marker>=0xd0&&marker<=0xd7)){if(!scan)throw new Error('Invalid JPEG entropy');continue;}
    if(marker===0xd9){segments.push({marker,start,end:p,payload:p});return segments;}
    if(marker===0xd8)throw new Error('Nested JPEG');
    const len=u16(b,p);if(len<2||p+len>b.length)throw new Error('Truncated JPEG segment');
    segments.push({marker,start,end:p+len,payload:p+2});p+=len;scan=marker===0xda;
    if(segments.length>10000)throw new Error('JPEG segment budget exceeded');
  }
  throw new Error('Missing JPEG EOI');
}
export interface Box {type: string; start: number; end: number; payload: number}
export function boxes(b: Uint8Array, start=0, end=b.length): Box[] {
  const result: Box[]=[];
  for(let p=start;p<end;){
    if(end-p<8)throw new Error('Truncated MP4 box');
    const small=u32(b,p), type=ascii(b,p+4,4); const size=small===1?u64(b,p+8):small===0?end-p:small;
    const header=small===1?16:8;if(size<header||p+size>end)throw new Error('Invalid MP4 box size');
    result.push({type,start:p,end:p+size,payload:p+header});p+=size;
    if(result.length>100000)throw new Error('MP4 box budget exceeded');
  }
  return result;
}
export function children(b: Uint8Array, parent: Box): Box[] {return boxes(b,parent.payload,parent.end);}
export function child(b: Uint8Array, parent: Box, name: string): Box {const box=children(b,parent).find(v=>v.type===name);if(!box)throw new Error('Missing '+name);return box;}
