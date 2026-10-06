// SPDX-License-Identifier: GPL-3.0-only
import {ascii,boxes,children,u32,equal,type Box} from './bytes';
import {applePhotoId} from './exif';
import {tracks,validateVideoPreservation} from './mp4';
export function quickTimeMetadata(b:Uint8Array):Map<string,Uint8Array>{
  const values=new Map<string,Uint8Array>();
  function read(parent:Box,depth:number):void{
    if(depth>8)throw new Error('Metadata depth budget');
    const nested=boxes(b,parent.payload+(parent.type==='meta'?4:0),parent.end);
    const keys=nested.find(v=>v.type==='keys'),ilst=nested.find(v=>v.type==='ilst');
    if(keys&&ilst){
      const count=u32(b,keys.payload+4);if(count>1000)throw new Error('Metadata key budget');
      const names:string[]=[];let p=keys.payload+8;
      for(let i=0;i<count;i++){const size=u32(b,p);if(size<8||p+size>keys.end)throw new Error('Invalid key');names.push(ascii(b,p+8,size-8));p+=size;}
      for(const item of children(b,ilst)){
        const index=u32(b,item.start+4)-1,name=names[index];if(!name)throw new Error('Metadata key index');
        const data=children(b,item).filter(v=>v.type==='data');
        if(data.length!==1)throw new Error('Multiple metadata values');
        if(values.has(name))throw new Error('Conflicting metadata identity');
        values.set(name,b.slice(data[0]!.payload+8,data[0]!.end));
      }
    }
    for(const box of nested)if(['moov','udta','meta'].includes(box.type))read(box,depth+1);
  }
  for(const box of boxes(b))if(box.type==='moov')read(box,0);
  return values;
}
export function appleVideoId(b:Uint8Array):string|undefined {
  const raw=quickTimeMetadata(b).get('com.apple.quicktime.content.identifier');if(!raw)return;
  const id=ascii(raw).replace(/\0+$/,'');if(!/^[\w-]{8,128}$/.test(id))throw new Error('Invalid Apple movie identity');return id;
}
export function trustedApplePair(photo:Uint8Array,movie:Uint8Array):boolean {
  const id=applePhotoId(photo);if(!id||id!==appleVideoId(movie))return false;
  const ts=tracks(movie);
  // Both the keyed timed-metadata track and its actual sample are required.
  return ts.some(t=>['meta','mdta'].includes(t.kind)&&t.samples.length>0&&t.sampleEntry==='mebx')&&ascii(movie).includes('com.apple.quicktime.still-image-time');
}
export async function validateAppleMovie(before:Uint8Array,after:Uint8Array):Promise<void>{
  await validateVideoPreservation(before,after,false,true);
  const old=quickTimeMetadata(before),next=quickTimeMetadata(after);
  if(!appleVideoId(before)||appleVideoId(before)!==appleVideoId(after))throw new Error('Apple pair identity changed');
  for(const [key,value]of old){const current=next.get(key);if(!current||!equal(value,current))throw new Error('QuickTime metadata changed: '+key);}
  if(!ascii(after).includes('com.apple.quicktime.still-image-time'))throw new Error('Apple still-image-time metadata lost');
}
