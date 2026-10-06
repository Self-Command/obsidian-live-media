// Public-domain synthetic ICC fixture, independently generated from D50 matrices.
import {concat,jpegSegments,ascii} from '../../src/media/bytes';
const utf=(s:string)=>new TextEncoder().encode(s);
const fixed=(b:Uint8Array,p:number,v:number)=>new DataView(b.buffer).setInt32(p,Math.round(v*65536));
export function profile(gamut:'srgb'|'display-p3'='display-p3'):Uint8Array {
  const matrix=gamut==='srgb'?[.436075,.222505,.013932,.385065,.716879,.097105,.14308,.060617,.714173]:[.5151,.2412,-.00105,.292,.6922,.04188,.1571,.06657,.78407];
  const xyz=(values:number[])=>{const b=new Uint8Array(20);b.set(utf('XYZ '));values.forEach((v,i)=>fixed(b,8+i*4,v));return b;};
  const trc=new Uint8Array(32);trc.set(utf('para'));new DataView(trc.buffer).setUint16(8,3);
  [2.4,1/1.055,.055/1.055,1/12.92,.04045].forEach((v,i)=>fixed(trc,12+i*4,v));
  const tags:Array<[string,Uint8Array]>=[['wtpt',xyz([.9642,1,.8249])],['rXYZ',xyz(matrix.slice(0,3))],['gXYZ',xyz(matrix.slice(3,6))],['bXYZ',xyz(matrix.slice(6,9))],['rTRC',trc],['gTRC',trc],['bTRC',trc]];
  const header=new Uint8Array(132+tags.length*12);let size=header.length;
  new DataView(header.buffer).setUint32(8,0x04000000);header.set(utf('mntrRGB XYZ '),12);header.set(utf('acsp'),36);
  [.9642,1,.8249].forEach((v,i)=>fixed(header,68+i*4,v));new DataView(header.buffer).setUint32(128,tags.length);
  tags.forEach(([name,b],i)=>{const at=132+i*12;header.set(utf(name),at);new DataView(header.buffer).setUint32(at+4,size);new DataView(header.buffer).setUint32(at+8,b.length);size+=b.length;});
  new DataView(header.buffer).setUint32(0,size);return concat(header,...tags.map(([,b])=>b));
}
export function addIcc(jpeg:Uint8Array,icc:Uint8Array,replace=true):Uint8Array {
  if(replace){const chunks:Uint8Array[]=[];let at=0;for(const s of jpegSegments(jpeg)){if(s.marker===0xe2&&ascii(jpeg,s.payload,12)==='ICC_PROFILE\0'){chunks.push(jpeg.slice(at,s.start));at=s.end;}}chunks.push(jpeg.slice(at));jpeg=concat(...chunks);}
  const data=concat(utf('ICC_PROFILE\0'),Uint8Array.of(1,1),icc),segment=new Uint8Array(data.length+4);
  segment.set([255,226]);new DataView(segment.buffer).setUint16(2,data.length+2);segment.set(data,4);
  return concat(jpeg.slice(0,2),segment,jpeg.slice(2));
}
