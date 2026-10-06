// SPDX-License-Identifier: GPL-3.0-only
import {ascii,equal,jpegSegments,concat} from './bytes';
import {mpfPictures} from './hdr';
import {xmpTags,namespaces} from './xmp';
const rebuiltNamespaces=new Set([
  'adobe:ns:meta/','http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  'http://ns.adobe.com/hdr-gain-map/1.0/','http://ns.google.com/photos/1.0/camera/',
  'http://ns.google.com/photos/1.0/container/','http://ns.google.com/photos/1.0/container/item/'
]);
/** Decoder success does not prove optional metadata survived. Protect everything the bridge cannot carry. */
export function requireHdrMetadataWriter(input:Uint8Array):void{
  for(const picture of mpfPictures(input).pictures)for(const segment of jpegSegments(input.subarray(picture.start,picture.end))){
    const bytes=input.subarray(picture.start,picture.end),marker=segment.marker;
    if(marker===0xfe)continue;
    if(marker<0xe0||marker>0xef||marker===0xe0)continue;
    const payload=ascii(bytes,segment.payload,segment.end-segment.payload);
    if(marker===0xe1&&payload.startsWith('Exif\0\0')){if(picture.start!==0)throw new Error('Gain-map EXIF metadata protected');continue;}
    if(marker===0xe2&&payload.startsWith('ICC_PROFILE'))continue;
    if(marker===0xe2&&(payload.startsWith('MPF\0')||payload.startsWith('urn:iso:std:iso:ts:21496')))continue;
    if(marker===0xe1&&payload.startsWith('http://ns.adobe.com/xap/1.0/\0')){
      const tags=xmpTags(payload.slice(29)),ns=namespaces(tags);
      for(const tag of tags){
        const uri=ns.get(tag.name.split(':')[0]!);if(uri&&!rebuiltNamespaces.has(uri))throw new Error('HDR ancillary XMP namespace protected');
        for(const [key]of tag.attrs)if(!key.startsWith('xmlns')){const uri=ns.get(key.split(':')[0]!);if(!uri||!rebuiltNamespaces.has(uri))throw new Error('HDR ancillary XMP attribute protected');}
      }continue;
    }
    throw new Error('HDR ancillary JPEG metadata protected');
  }
}
export function verifyHdrMetadata(before:Uint8Array,after:Uint8Array):void{
  for(const prefix of ['Exif\0\0']){
    const selected=(b:Uint8Array)=>mpfPictures(b).pictures.flatMap(p=>{const image=b.subarray(p.start,p.end);return jpegSegments(image).filter(s=>ascii(image,s.payload,prefix.length)===prefix).map(s=>image.slice(s.start,s.end));});
    const old=selected(before),next=selected(after);
    if(old.length&&!old.every((bytes,i)=>next[i]&&equal(bytes,next[i]!)))throw new Error('HDR EXIF metadata preservation failed');
  }
}
export function retainHdrComments(before:Uint8Array,after:Uint8Array):Uint8Array{
  const original=mpfPictures(before),next=mpfPictures(after);
  const comments=original.pictures.map(p=>{const image=before.subarray(p.start,p.end);return concat(...jpegSegments(image).filter(s=>s.marker===0xfe).map(s=>image.slice(s.start,s.end)));});
  if(comments.every(b=>!b.length))return after;
  // Codec comments are replaced with the original comments; the encoder-generated version has no semantic value.
  const cleaned=next.pictures.map(p=>{const image=after.subarray(p.start,p.end);let at=0;const parts:Uint8Array[]=[];
    for(const segment of jpegSegments(image).filter(s=>s.marker===0xfe)){parts.push(image.slice(at,segment.start));at=segment.end;}parts.push(image.slice(at));return concat(...parts);});
  // Rebuild with unchanged MPF origin placement relative to the primary JPEG start.
  const oldFirstSize=next.pictures[0]!.end,oldSecondSize=next.pictures[1]!.end-next.pictures[1]!.start;
  const first=concat(cleaned[0]!.slice(0,2),comments[0]!,cleaned[0]!.slice(2)),second=concat(cleaned[1]!.slice(0,2),comments[1]!,cleaned[1]!.slice(2));
  const output=concat(first,second),firstDelta=first.length-oldFirstSize;
  // Find the MPF header after insertion; index extents are patched before parsing the new pictures.
  const segment=jpegSegments(first).find(s=>s.marker===0xe2&&ascii(first,s.payload,4)==='MPF\0')!;
  const origin=segment.payload+4,little=ascii(first,origin,2)==='II',v=new DataView(output.buffer);
  const originalIndex=mpfPictures(after);
  // The primary insertion and removed comments may shift the origin differently from the picture boundary.
  const originalMpf=jpegSegments(after).find(s=>s.marker===0xe2&&ascii(after,s.payload,4)==='MPF\0')!;
  const originDelta=origin-(originalMpf.payload+4);
  const shiftField=(field:number)=>field+originDelta;
  v.setUint32(shiftField(originalIndex.pictures[0]!.sizeField),first.length,little);
  v.setUint32(shiftField(originalIndex.pictures[1]!.sizeField),second.length,little);
  const offsetField=shiftField(originalIndex.pictures[1]!.offsetField);
  v.setUint32(offsetField,new DataView(after.buffer,after.byteOffset).getUint32(originalIndex.pictures[1]!.offsetField,little)+firstDelta-originDelta,little);
  if(mpfPictures(output).pictures[1]!.end!==output.length||oldSecondSize<=0)throw new Error('HDR comments index readback failed');return output;
}
