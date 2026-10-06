// SPDX-License-Identifier: GPL-3.0-only
import {boxes,children,child,concat,u32,u64,equal,type Box} from './bytes';
import {tracks} from './mp4';
const box=(type:string,body:Uint8Array)=>{const b=new Uint8Array(body.length+8);new DataView(b.buffer).setUint32(0,b.length);b.set(new TextEncoder().encode(type),4);b.set(body,8);return b;};
const table=(type:string,values:number[])=>{const b=new Uint8Array(4+values.length*4);values.forEach((v,i)=>new DataView(b.buffer).setUint32(4+i*4,v));return box(type,b);};
const rebuild=(b:Uint8Array,parent:Box,parts:Map<string,Uint8Array>)=>box(parent.type,concat(...children(b,parent).map(c=>parts.get(c.type)??b.slice(c.start,c.end))));
const converted=(time:number,from:number,to:number)=>{const n=BigInt(time)*BigInt(to);if(n%BigInt(from))throw new Error('Unrepresentable exact timeline');const r=Number(n/BigInt(from));if(!Number.isSafeInteger(r)||r<0)throw new Error('Timeline budget');return r;};
function duration(b:Uint8Array,h:Box,type:'mvhd'|'mdhd'|'tkhd'):number{
  const wide=b[h.payload]===1,at=h.payload+(type==='tkhd'?(wide?28:20):(wide?24:16));return wide?u64(b,at):u32(b,at);
}
function withDuration(b:Uint8Array,h:Box,type:'mvhd'|'mdhd'|'tkhd',value:number):Uint8Array{
  const out=b.slice(h.start,h.end),wide=b[h.payload]===1,at=h.payload-h.start+(type==='tkhd'?(wide?28:20):(wide?24:16)),view=new DataView(out.buffer);
  if(wide)view.setBigUint64(at,BigInt(value));else{if(value>0xffffffff)throw new Error('Timeline exceeds header width');view.setUint32(at,value);}return out;
}
/** Restore the source's exact final-frame duration after reencode. All frame
 * presentation times must already match. Never stretch frames or audio. */
export function restoreMotionEndTime(original:Uint8Array,encoded:Uint8Array):Uint8Array{
  const old=tracks(original),next=tracks(encoded),index=old.findIndex(t=>t.kind==='vide');
  if(index<0||old.length!==next.length||old.filter(t=>t.kind==='vide').length!==1)throw new Error('Unsupported timeline track structure');
  const a=old[index]!,b=next[index]!;
  if(a.kind!==b.kind||a.samples.length!==b.samples.length||!equal(a.matrix,b.matrix)||a.width!==b.width||a.height!==b.height)throw new Error('Timeline media identity changed');
  const aa=[...a.pts].sort((x,y)=>x-y),bb=[...b.pts].sort((x,y)=>x-y);
  if(!aa.every((t,i)=>BigInt(t)*BigInt(b.timescale)===BigInt(bb[i]!)*BigInt(a.timescale)))throw new Error('Frame presentation time changed');
  const target=converted(a.duration,a.timescale,b.timescale);if(target===b.duration)return encoded;
  const oldMoov=boxes(original).find(v=>v.type==='moov')!,moov=boxes(encoded).find(v=>v.type==='moov')!,ftyp=boxes(encoded).find(v=>v.type==='ftyp');
  if(!ftyp||boxes(encoded).some(v=>!['ftyp','moov','mdat','free','wide'].includes(v.type)))throw new Error('Unclassified timeline container');
  const oldMvhd=child(original,oldMoov,'mvhd'),mvhd=child(encoded,moov,'mvhd');
  const oldScale=u32(original,oldMvhd.payload+(original[oldMvhd.payload]===1?20:12)),scale=u32(encoded,mvhd.payload+(encoded[mvhd.payload]===1?20:12));
  const oldTraks=children(original,oldMoov).filter(v=>v.type==='trak'),traks=children(encoded,moov).filter(v=>v.type==='trak');
  const ftypBytes=encoded.slice(ftyp.start,ftyp.end),payloads:Uint8Array[]=[],out:Uint8Array[]=[];let offset=ftypBytes.length+8;
  for(let i=0;i<next.length;i++){
    const trak=traks[i]!,mdia=child(encoded,trak,'mdia'),minf=child(encoded,mdia,'minf'),stbl=child(encoded,minf,'stbl'),stsc=child(encoded,stbl,'stsc');
    for(let row=0,n=u32(encoded,stsc.payload+4);row<n;row++)if(u32(encoded,stsc.payload+16+row*12)!==1)throw new Error('Multiple sample mappings protected');
    let timeline:Uint8Array|undefined;
    if(i===index){
      const stts=child(encoded,stbl,'stts'),count=u32(encoded,stts.payload+4),runs:Array<[number,number]>=[];
      if(count<1||count>next[i]!.samples.length)throw new Error('Invalid timing runs');
      for(let r=0;r<count;r++)runs.push([u32(encoded,stts.payload+8+r*8),u32(encoded,stts.payload+12+r*8)]);
      const last=runs.pop()!,lastDelta=last[1]+target-b.duration;
      if(lastDelta<=0||lastDelta>0xffffffff)throw new Error('Invalid final sample duration');
      if(last[0]>1)runs.push([last[0]-1,last[1]]);runs.push([1,lastDelta]);
      timeline=table('stts',[runs.length,...runs.flat()]);
    }
    const parts=children(encoded,stbl).filter(v=>!['stco','co64','stsc'].includes(v.type)).map(v=>v.type==='stts'&&timeline?timeline:encoded.slice(v.start,v.end));
    parts.push(table('stsc',[1,1,next[i]!.samples.length,1]),table('stco',[1,offset]));
    const newMinf=rebuild(encoded,minf,new Map([['stbl',box('stbl',concat(...parts))]]));
    const mdiaParts=new Map<string,Uint8Array>([['minf',newMinf]]);
    if(i===index)mdiaParts.set('mdhd',withDuration(encoded,child(encoded,mdia,'mdhd'),'mdhd',target));
    const trackParts=new Map<string,Uint8Array>([['mdia',rebuild(encoded,mdia,mdiaParts)]]);
    if(i===index){const header=child(encoded,trak,'tkhd'),oldHeader=child(original,oldTraks[i]!,'tkhd');trackParts.set('tkhd',withDuration(encoded,header,'tkhd',converted(duration(original,oldHeader,'tkhd'),oldScale,scale)));}
    out.push(rebuild(encoded,trak,trackParts));const samples=concat(...next[i]!.samples);payloads.push(samples);offset+=samples.length;if(offset>0xffffffff)throw new Error('Movie offset budget');
  }
  let at=0;const newMoov=box('moov',concat(...children(encoded,moov).map(v=>v.type==='trak'?out[at++]!:v.type==='mvhd'?withDuration(encoded,mvhd,'mvhd',converted(duration(original,oldMvhd,'mvhd'),oldScale,scale)):encoded.slice(v.start,v.end))));
  return concat(ftypBytes,box('mdat',concat(...payloads)),newMoov);
}
