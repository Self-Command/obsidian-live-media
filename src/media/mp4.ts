// SPDX-License-Identifier: GPL-3.0-only
import {ascii, boxes, child, children, equal, hash, u32, u64, type Box} from './bytes';
export interface Track {
  kind: string; timescale: number; pts: number[]; duration: number;
  samples: Uint8Array[]; matrix: Uint8Array; sampleEntry: string;
  width: number; height: number; color: Uint8Array[];
}
function i32(b: Uint8Array,p: number): number {return new DataView(b.buffer,b.byteOffset,b.byteLength).getInt32(p);}
export function tracks(b: Uint8Array): Track[] {
  const moov=boxes(b).find(v=>v.type==='moov');if(!moov)throw new Error('No moov');
  return children(b,moov).filter(v=>v.type==='trak').map(trak=>{
    const tkhd=child(b,trak,'tkhd'),mdia=child(b,trak,'mdia');
    const mdhd=child(b,mdia,'mdhd'),hdlr=child(b,mdia,'hdlr');
    const stbl=child(b,child(b,mdia,'minf'),'stbl');
    const ts=u32(b,mdhd.payload+(b[mdhd.payload]===1?20:12));if(!ts)throw new Error('Zero timescale');
    const stts=child(b,stbl,'stts'),stsz=child(b,stbl,'stsz'),stsc=child(b,stbl,'stsc');
    const table=children(b,stbl);const offsets=table.find(v=>v.type==='stco'||v.type==='co64');if(!offsets)throw new Error('No chunk offsets');
    const n=u32(b,stsz.payload+8);if(n>1000000)throw new Error('Sample count budget exceeded');
    const size=u32(b,stsz.payload+4),sizes=Array.from({length:n},(_,i)=>size||u32(b,stsz.payload+12+4*i));
    const chunkCount=u32(b,offsets.payload+4);if(chunkCount>1000000)throw new Error('Chunk budget exceeded');
    const chunkOffsets=Array.from({length:chunkCount},(_,i)=>offsets.type==='co64'?u64(b,offsets.payload+8+8*i):u32(b,offsets.payload+8+4*i));
    const scCount=u32(b,stsc.payload+4);if(scCount>chunkCount+1)throw new Error('Invalid stsc');
    const sc=Array.from({length:scCount},(_,i)=>({first:u32(b,stsc.payload+8+12*i),count:u32(b,stsc.payload+12+12*i)}));
    if(sc[0]?.first!==1)throw new Error('Invalid first chunk');
    const samples: Uint8Array[]=[];let index=0,group=0;
    for(let c=0;c<chunkCount;c++){
      while(sc[group+1]&&sc[group+1]!.first<=c+1)group++;
      let position=chunkOffsets[c]!;
      for(let j=0;j<sc[group]!.count;j++){
        const length=sizes[index++];if(length===undefined||position+length>b.length)throw new Error('Invalid sample extent');
        const mdat=boxes(b).find(v=>v.type==='mdat'&&position>=v.payload&&position+length<=v.end);
        if(!mdat)throw new Error('Sample outside mdat');
        samples.push(b.subarray(position,position+length));position+=length;
      }
    }
    if(index!==n)throw new Error('Sample count mismatch');
    const dts: number[]=[];let time=0;
    for(let i=0,count=u32(b,stts.payload+4);i<count;i++){
      const repeat=u32(b,stts.payload+8+8*i),delta=u32(b,stts.payload+12+8*i);
      if(dts.length+repeat>n)throw new Error('Invalid stts');
      for(let j=0;j<repeat;j++){dts.push(time);time+=delta;}
    }
    if(dts.length!==n)throw new Error('Timeline count mismatch');
    const ctts=table.find(v=>v.type==='ctts');if(ctts){let i=0;
      for(let e=0,count=u32(b,ctts.payload+4);e<count;e++){
        const repeat=u32(b,ctts.payload+8+8*e),delta=(b[ctts.payload]===1?i32:u32)(b,ctts.payload+12+8*e);
        for(let j=0;j<repeat;j++){if(i>=n)throw new Error('Invalid ctts');dts[i]=dts[i]!+delta;i++;}
      }if(i!==n)throw new Error('Incomplete ctts');
    }
    const edts=children(b,trak).find(v=>v.type==='edts');if(edts){
      const elst=child(b,edts,'elst');const version=b[elst.payload],entries=u32(b,elst.payload+4);
      if(entries!==1||version!==0)throw new Error('Complex edit list protected');
      const mediaTime=i32(b,elst.payload+12);if(mediaTime<0)throw new Error('Empty edit protected');
      if(u32(b,elst.payload+16)!==0x00010000)throw new Error('Non-unit playback rate');
      for(let i=0;i<dts.length;i++)dts[i]=dts[i]!-mediaTime;
    }
    const stsd=child(b,stbl,'stsd');if(u32(b,stsd.payload+4)!==1)throw new Error('Multiple sample descriptions');
    const entry=boxes(b,stsd.payload+8,stsd.end)[0]!;
    const kind=ascii(b,hdlr.payload+8,4);
    const matrixStart=tkhd.payload+(b[tkhd.payload]===1?52:40);
    const width=kind==='vide'?u32(b,tkhd.end-8)>>>16:0,height=kind==='vide'?u32(b,tkhd.end-4)>>>16:0;
    let color: Uint8Array[]=[];
    if(kind==='vide'&&entry.end>=entry.start+86)color=boxes(b,entry.start+86,entry.end).filter(v=>v.type==='colr').map(v=>b.slice(v.payload,v.end));
    return {kind,timescale:ts,pts:dts,duration:time,samples,matrix:b.slice(matrixStart,matrixStart+36),sampleEntry:entry.type,width,height,color};
  });
}
function equalTime(a: number,scaleA:number,b:number,scaleB:number): boolean {return BigInt(a)*BigInt(scaleB)===BigInt(b)*BigInt(scaleA);}
export async function validateVideoPreservation(before: Uint8Array, after: Uint8Array, resize=false,allowVerifiedApple=false): Promise<void> {
  const old=tracks(before),next=tracks(after);
  if(old.length!==next.length)throw new Error('Track count changed');
  for(let i=0;i<old.length;i++){
    const a=old[i]!,b=next[i]!;
    if(a.kind!==b.kind||a.samples.length!==b.samples.length)throw new Error('Track or frame count changed');
    if(!equal(a.matrix,b.matrix))throw new Error('Orientation matrix changed');
    if(a.kind==='vide'){
      if(!resize&&(a.width!==b.width||a.height!==b.height))throw new Error('Video dimensions changed');
      if(JSON.stringify(a.color.map(c=>Array.from(c)))!==JSON.stringify(b.color.map(c=>Array.from(c))))throw new Error('Color metadata changed');
      const aa=[...a.pts].sort((x,y)=>x-y),bb=[...b.pts].sort((x,y)=>x-y);
      if(!aa.every((t,j)=>equalTime(t,a.timescale,bb[j]!,b.timescale)))throw new Error('Frame presentation time changed');
      if(!equalTime(a.duration,a.timescale,b.duration,b.timescale))throw new Error('Track duration changed');
    }else{
      if(a.sampleEntry!==b.sampleEntry||!a.pts.every((t,j)=>equalTime(t,a.timescale,b.pts[j]!,b.timescale)))throw new Error('Audio/data identity changed');
      for(let j=0;j<a.samples.length;j++)if(await hash(a.samples[j]!)!==await hash(b.samples[j]!))throw new Error('Audio/data sample changed');
    }
  }
  // File-level proprietary metadata is protected until its container writer is proven.
  const protectedText=ascii(before).match(/com\.apple\.quicktime\.[\w.-]+/g);
  if(protectedText?.length&&!allowVerifiedApple)throw new Error('Apple QuickTime identity requires verified pair writer');
}
export function validateCoverTime(video:Uint8Array,timestamp:string|undefined):void {
  if(timestamp===undefined||timestamp==='-1')return;
  const time=BigInt(timestamp);if(time<0n)throw new Error('Invalid cover timestamp');
  const track=tracks(video).find(t=>t.kind==='vide');if(!track)throw new Error('No video track');
  if(time*BigInt(track.timescale)>BigInt(track.duration)*1000000n)throw new Error('Cover timestamp lies outside the movie');
}
