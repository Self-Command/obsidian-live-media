// SPDX-License-Identifier: GPL-3.0-only
import {ascii,jpegSegments,concat} from './bytes';
import {probe} from './probe';
export interface Picture {start:number;end:number;sizeField:number;offsetField:number}
export function mpfPictures(b:Uint8Array):{pictures:Picture[];base:number;little:boolean} {
  const seg=jpegSegments(b).find(s=>s.marker===0xe2&&ascii(b,s.payload,4)==='MPF\0');if(!seg)throw new Error('No MPF index');
  const base=seg.payload+4,little=ascii(b,base,2)==='II';if(!little&&ascii(b,base,2)!=='MM')throw new Error('Invalid MPF byte order');
  const view=new DataView(b.buffer,b.byteOffset,b.byteLength);
  const get16=(p:number)=>{if(p<base||p+2>seg.end)throw new Error('MPF extent');return view.getUint16(p,little);};
  const get32=(p:number)=>{if(p<base||p+4>seg.end)throw new Error('MPF extent');return view.getUint32(p,little);};
  if(get16(base+2)!==42)throw new Error('MPF TIFF magic');const ifd=base+get32(base+4),count=get16(ifd);if(count>100)throw new Error('MPF entry budget');
  let number=0,index=0,length=0;
  for(let i=0;i<count;i++){const p=ifd+2+i*12,tag=get16(p);if(tag===0xb001)number=get32(p+8);if(tag===0xb002){length=get32(p+4);index=base+get32(p+8);}}
  if(number!==2||length!==number*16||!index||index+length>seg.end)throw new Error('Only verified two-picture gain-map index supported');
  const pictures=Array.from({length:number},(_,i)=>{
    const p=index+16*i,size=get32(p+4),offset=get32(p+8),start=offset?base+offset:0;
    if(size<=0||start+size>b.length||b[start]!==255||b[start+1]!==216)throw new Error('Invalid MPF picture extent');
    const end=start+jpegSegments(b.subarray(start,start+size)).at(-1)!.end;
    if(end!==start+size)throw new Error('MPF picture length mismatch');
    return {start,end,sizeField:p+4,offsetField:p+8};
  });
  if(pictures[0]!.start!==0||pictures[1]!.start<pictures[0]!.end)throw new Error('MPF picture overlap');
  return {pictures,base,little};
}
export function addMotionToHdr(hdr:Uint8Array,video:Uint8Array,timestamp:string|undefined):Uint8Array{
  const index=mpfPictures(hdr),end=index.pictures[1]!.end;
  if(end!==hdr.length)throw new Error('Unclassified HDR trailing bytes');
  if(timestamp!==undefined&&!/^-?\d{1,20}$/.test(timestamp))throw new Error('Invalid presentation timestamp');
  const xml=`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:GCamera="http://ns.google.com/photos/1.0/camera/" xmlns:Container="http://ns.google.com/photos/1.0/container/" xmlns:Item="http://ns.google.com/photos/1.0/container/item/" GCamera:MotionPhoto="1" GCamera:MotionPhotoVersion="1" GCamera:MotionPhotoPresentationTimestampUs="${timestamp??'-1'}"><Container:Directory><rdf:Seq><rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="image/jpeg" Item:Semantic="Primary" Item:Padding="0"/></rdf:li><rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="image/jpeg" Item:Semantic="GainMap" Item:Length="${index.pictures[1]!.end-index.pictures[1]!.start}" Item:Padding="0"/></rdf:li><rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="video/mp4" Item:Semantic="MotionPhoto" Item:Length="${video.length}" Item:Padding="0"/></rdf:li></rdf:Seq></Container:Directory></rdf:Description></rdf:RDF></x:xmpmeta>`;
  const payload=concat(new TextEncoder().encode('http://ns.adobe.com/xap/1.0/\0'),new TextEncoder().encode(xml));
  const segment=new Uint8Array(payload.length+4);segment.set([255,225]);new DataView(segment.buffer).setUint16(2,payload.length+2);segment.set(payload,4);
  const photo=concat(hdr.subarray(0,2),segment,hdr.subarray(2));
  const view=new DataView(photo.buffer);
  // Insertion is before both the MPF TIFF origin and secondary image, so relative secondary offset remains invariant.
  view.setUint32(index.pictures[0]!.sizeField+segment.length,index.pictures[0]!.end+segment.length,index.little);
  const newIndex=mpfPictures(photo);
  if(newIndex.pictures[1]!.end!==photo.length)throw new Error('HDR index readback failed');
  const output=concat(photo,video),p=probe(output);
  if(!p.live||!p.hdr||p.timestamp!==(timestamp??'-1'))throw new Error('Reconstructed motion/HDR metadata failed');
  return output;
}
