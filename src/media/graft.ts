// SPDX-License-Identifier: GPL-3.0-only
import {boxes,children,child,concat,u32,type Box} from './bytes';
import {tracks} from './mp4';
function box(type:string,bytes:Uint8Array):Uint8Array{const result=new Uint8Array(8+bytes.length);new DataView(result.buffer).setUint32(0,result.length);result.set(new TextEncoder().encode(type),4);result.set(bytes,8);return result;}
function fullTable(type:string,values:number[]):Uint8Array{const b=new Uint8Array(4+values.length*4),v=new DataView(b.buffer);values.forEach((n,i)=>v.setUint32(4+4*i,n));return box(type,b);}
function rebuild(b:Uint8Array,parent:Box,replacements:Map<string,Uint8Array>):Uint8Array{
  return box(parent.type,concat(...children(b,parent).map(c=>replacements.get(c.type)??b.slice(c.start,c.end))));
}
/** Independent QuickTime container writer. Keep original audio/data samples, sample descriptions,
 * timed metadata and movie metadata. Only the video track is supplied by the encoder. */
export function graftAppleVideo(original:Uint8Array,encoded:Uint8Array):Uint8Array{
  const oldTop=boxes(original),newTop=boxes(encoded),oldMoov=oldTop.find(b=>b.type==='moov'),newMoov=newTop.find(b=>b.type==='moov');
  const ftyp=oldTop.find(b=>b.type==='ftyp');if(!oldMoov||!newMoov||!ftyp)throw new Error('Incomplete movie');
  if(oldTop.some(b=>!['ftyp','moov','mdat','free','wide'].includes(b.type)))throw new Error('Unclassified Apple top-level box protected');
  const oldTracks=tracks(original),newTracks=tracks(encoded);
  const sourceVideo=newTracks.findIndex(t=>t.kind==='vide');if(sourceVideo<0||newTracks.filter(t=>t.kind==='vide').length!==1)throw new Error('One encoded video required');
  if(oldTracks.filter(t=>t.kind==='vide').length!==1)throw new Error('Multiple original videos protected');
  const oldTraks=children(original,oldMoov).filter(t=>t.type==='trak');
  const newVideo=children(encoded,newMoov).filter(t=>t.type==='trak')[sourceVideo]!;
  const outTraks:Uint8Array[]=[],payloads:Uint8Array[]=[];
  const ftypBytes=original.slice(ftyp.start,ftyp.end);
  // Put mdat before moov. Every track becomes one chunk; timing and sample descriptions stay intact.
  let offset=ftypBytes.length+8;
  for(let i=0;i<oldTracks.length;i++){
    const old=oldTracks[i]!,isVideo=old.kind==='vide',data=isVideo?encoded:original;
    const trak=isVideo?newVideo:oldTraks[i]!,samples=isVideo?newTracks[sourceVideo]!.samples:old.samples;
    const sampleBytes=concat(...samples);payloads.push(sampleBytes);
    const mdia=child(data,trak,'mdia'),minf=child(data,mdia,'minf'),stbl=child(data,minf,'stbl');
    const originalStsc=child(data,stbl,'stsc');
    for(let row=0,n=u32(data,originalStsc.payload+4);row<n;row++)if(u32(data,originalStsc.payload+16+12*row)!==1)throw new Error('Multiple sample description mapping protected');
    const tableParts=children(data,stbl).filter(v=>!['stco','co64','stsc'].includes(v.type)).map(v=>data.slice(v.start,v.end));
    tableParts.push(fullTable('stsc',[1,1,samples.length,1]),fullTable('stco',[1,offset]));
    const newStbl=box('stbl',concat(...tableParts)),newMinf=rebuild(data,minf,new Map([['stbl',newStbl]]));
    const newMdia=rebuild(data,mdia,new Map([['minf',newMinf]]));
    let tkhd=data.slice(child(data,trak,'tkhd').start,child(data,trak,'tkhd').end);
    if(isVideo){
      const oldTkhd=child(original,oldTraks[i]!,'tkhd'),oldId=u32(original,oldTkhd.payload+(original[oldTkhd.payload]===1?20:12));
      const header=8,field=header+(tkhd[header]===1?20:12);new DataView(tkhd.buffer).setUint32(field,oldId);
    }
    outTraks.push(rebuild(data,trak,new Map([['mdia',newMdia],['tkhd',tkhd]])));
    offset+=sampleBytes.length;if(offset>0xffffffff)throw new Error('Output chunk exceeds 32-bit offset');
  }
  let trackIndex=0;
  const moov=box('moov',concat(...children(original,oldMoov).map(c=>c.type==='trak'?outTraks[trackIndex++]!:original.slice(c.start,c.end))));
  return concat(ftypBytes,box('mdat',concat(...payloads)),moov);
}
