// SPDX-License-Identifier: GPL-3.0-only
import {ascii,equal,jpegSegments,u16,u32,concat} from './bytes';
export type JpegIcc={bytes:Uint8Array;gamut?:'srgb'|'display-p3'};
// ICC v2/v4 matrix profiles. Unsupported profiles remain playable with video-only
// processing; reencoding requires a recognized gamut and a color-managed comparison.
export function jpegIcc(input:Uint8Array):JpegIcc|undefined {
  const chunks=jpegSegments(input).filter(s=>s.marker===0xe2&&ascii(input,s.payload,12)==='ICC_PROFILE\0');
  if(!chunks.length)return;
  const count=input[chunks[0]!.payload+13]!;
  if(!count||chunks.length!==count)throw new Error('Incomplete ICC profile');
  const parts=new Map<number,Uint8Array>();
  for(const s of chunks){const order=input[s.payload+12]!;
    if(s.end-s.payload<14||input[s.payload+13]!==count||order<1||order>count||parts.has(order))throw new Error('Invalid ICC chunk sequence');
    parts.set(order,input.slice(s.payload+14,s.end));}
  const bytes=concat(...Array.from({length:count},(_,i)=>parts.get(i+1)!));
  if(bytes.length<132||bytes.length>4*1048576||u32(bytes,0)!==bytes.length||ascii(bytes,36,4)!=='acsp')throw new Error('Invalid ICC header');
  const result:JpegIcc={bytes};if(ascii(bytes,16,4)!=='RGB '||ascii(bytes,20,4)!=='XYZ ')return result;
  const n=u32(bytes,128);if(n>256||132+n*12>bytes.length)throw new Error('Invalid ICC tag directory');
  const tags=new Map<string,Uint8Array>();
  for(let i=0;i<n;i++){const p=132+i*12,name=ascii(bytes,p,4),at=u32(bytes,p+4),length=u32(bytes,p+8);
    if(at<132+n*12||at%4||length<8||at+length>bytes.length||tags.has(name))throw new Error('Invalid ICC tag range');
    tags.set(name,bytes.slice(at,at+length));}
  const fixed=(b:Uint8Array,p:number)=>new DataView(b.buffer,b.byteOffset,b.byteLength).getInt32(p)/65536;
  const xyz=(name:string)=>{const t=tags.get(name);return t&&t.length>=20&&ascii(t,0,4)==='XYZ '?[fixed(t,8),fixed(t,12),fixed(t,16)]:undefined;};
  const matrix=['rXYZ','gXYZ','bXYZ'].flatMap(name=>xyz(name)??[]),white=xyz('wtpt');
  if(matrix.length!==9||!white||white.some((v,i)=>Math.abs(v-[.9642,1,.8249][i]!)>.004))return result;
  const srgb=[.436075,.222505,.013932,.385065,.716879,.097105,.14308,.060617,.714173];
  const p3=[.5151,.2412,-.00105,.292,.6922,.04188,.1571,.06657,.78407];
  const matches=(expected:number[])=>matrix.every((v,i)=>Math.abs(v-expected[i]!)<.004);
  const trcValid=['rTRC','gTRC','bTRC'].every(name=>{const t=tags.get(name);if(!t)return false;
    if(ascii(t,0,4)==='curv'){
      if(t.length<12)return false;const count=u32(t,8);if(count>8192||t.length<12+count*2)return false;
      if(count===0)return true;if(count===1)return u16(t,12)>=256&&u16(t,12)<=768;
      for(let i=1;i<count;i++)if(u16(t,12+i*2)<u16(t,10+i*2))return false;return true;
    }
    if(ascii(t,0,4)!=='para'||t.length<16)return false;
    const kind=u16(t,8),counts=[1,3,4,5,7];if(kind>4||t.length<12+counts[kind]!*4)return false;
    const gamma=fixed(t,12);return Number.isFinite(gamma)&&gamma>=1&&gamma<=3;
  });
  if(trcValid)result.gamut=matches(p3)?'display-p3':matches(srgb)?'srgb':undefined;
  return result;
}
export async function validateJpegColor(before:Uint8Array,after:Uint8Array,signal:AbortSignal):Promise<void>{
  const source=jpegIcc(before),target=jpegIcc(after);
  if(!source?.gamut||!target||!equal(source.bytes,target.bytes))throw new Error('ICC profile missing, changed, or unsupported');
  if(typeof createImageBitmap!=='function'||typeof document==='undefined')throw new Error('Color-managed decoder unavailable; original protected');
  const sample=async(bytes:Uint8Array)=>{
    if(signal.aborted)throw new Error('Cancelled');
    const bitmap=await createImageBitmap(new Blob([bytes.slice().buffer],{type:'image/jpeg'}),{colorSpaceConversion:'default',imageOrientation:'from-image'});
    let canvas:HTMLCanvasElement|undefined;
    try{
      if(signal.aborted)throw new Error('Cancelled');
      const scale=Math.min(1,512/Math.max(bitmap.width,bitmap.height));
      canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      const ctx=canvas.getContext('2d',{colorSpace:source.gamut,willReadFrequently:true});
      if(!ctx||ctx.getContextAttributes().colorSpace!==source.gamut)throw new Error('Required color-space canvas unavailable; original protected');
      ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      return {width:bitmap.width,height:bitmap.height,pixels:ctx.getImageData(0,0,canvas.width,canvas.height).data};
    }finally{bitmap.close();if(canvas){canvas.width=0;canvas.height=0;}}
  };
  const a=await sample(before),b=await sample(after);
  if(signal.aborted)throw new Error('Cancelled');
  if(a.width!==b.width||a.height!==b.height||a.pixels.length!==b.pixels.length)throw new Error('ICC validation dimensions changed');
  let sum=0;const bias=[0,0,0];
  for(let i=0;i<a.pixels.length;i+=4)for(let channel=0;channel<3;channel++){const d=(b.pixels[i+channel]!-a.pixels[i+channel]!)/255;sum+=d*d;bias[channel]!+=d;}
  const pixels=a.pixels.length/4,rms=Math.sqrt(sum/(pixels*3));
  if(rms>.06||bias.some(v=>Math.abs(v/pixels)>.012))throw new Error('ICC color comparison failed; original protected');
}
