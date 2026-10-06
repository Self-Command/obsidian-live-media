// SPDX-License-Identifier: GPL-3.0-only
import {ascii,boxes,children,child,u32,equal,type Box} from './bytes';
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
  const ts=tracks(movie),moov=boxes(movie).find(b=>b.type==='moov')!;
  const traks=children(movie,moov).filter(b=>b.type==='trak');
  for(let i=0;i<ts.length;i++){
    const track=ts[i]!;if(!['meta','mdta'].includes(track.kind)||track.sampleEntry!=='mebx')continue;
    const stsd=child(movie,child(movie,child(movie,child(movie,traks[i]!,'mdia'),'minf'),'stbl'),'stsd');
    const entry=boxes(movie,stsd.payload+8,stsd.end)[0]!;
    const keys=boxes(movie,entry.payload+8,entry.end).find(b=>b.type==='keys');if(!keys)continue;
    for(const key of children(movie,keys)){
      const local=u32(movie,key.start+4);if(local===0||local===0xffffffff)continue;
      const fields=children(movie,key),declaration=fields.find(b=>b.type==='keyd'),datatype=fields.find(b=>b.type==='dtyp');
      if(!declaration||ascii(movie,declaration.payload,4)!=='mdta'||ascii(movie,declaration.payload+4,declaration.end-declaration.payload-4)!=='com.apple.quicktime.still-image-time')continue;
      // Apple's fixed-size signed-byte timed metadata. Do not trust a string found elsewhere.
      if(!datatype||datatype.end-datatype.payload!==8||u32(movie,datatype.payload)!==0||u32(movie,datatype.payload+4)!==65)continue;
      for(const sample of track.samples)for(const atom of boxes(sample))
        if(u32(sample,atom.start+4)===local&&atom.end-atom.payload===1&&[0,255].includes(sample[atom.payload]!))return true;
    }
  }return false;
}
export async function validateAppleMovie(before:Uint8Array,after:Uint8Array):Promise<void>{
  await validateVideoPreservation(before,after,false,true);
  const old=quickTimeMetadata(before),next=quickTimeMetadata(after);
  if(!appleVideoId(before)||appleVideoId(before)!==appleVideoId(after))throw new Error('Apple pair identity changed');
  for(const [key,value]of old){const current=next.get(key);if(!current||!equal(value,current))throw new Error('QuickTime metadata changed: '+key);}
  if(!ascii(after).includes('com.apple.quicktime.still-image-time'))throw new Error('Apple still-image-time metadata lost');
}
