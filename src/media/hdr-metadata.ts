// SPDX-License-Identifier: GPL-3.0-only
import {ascii,equal,jpegSegments} from './bytes';
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
    if(marker===0xfe)throw new Error('HDR comment metadata has no verified preservation writer');
    if(marker<0xe0||marker>0xef||marker===0xe0)continue;
    const payload=ascii(bytes,segment.payload,segment.end-segment.payload);
    if(marker===0xe1&&payload.startsWith('Exif\0\0')){if(picture.start!==0)throw new Error('Gain-map EXIF metadata protected');continue;}
    if(marker===0xe2&&payload.startsWith('ICC_PROFILE')){if(picture.start!==0)throw new Error('Gain-map ICC metadata protected');continue;}
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
  for(const prefix of ['Exif\0\0','ICC_PROFILE']){
    const selected=(b:Uint8Array)=>jpegSegments(b).filter(s=>ascii(b,s.payload,prefix.length)===prefix).map(s=>b.slice(s.start,s.end));
    const old=selected(before),next=selected(after);
    if(old.length&&!old.every((bytes,i)=>next[i]&&equal(bytes,next[i]!)))throw new Error('HDR EXIF/ICC metadata preservation failed');
  }
}
