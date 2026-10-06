import {it,expect,vi} from 'vitest';
vi.mock('virtual:codec-assets',()=>({assets:{}}));
import {BatchService,type Store,type Prepared} from '../../src/compression/batch';
import {Compressor} from '../../src/compression/encode';
import {hash} from '../../src/media/bytes';
import {defaults} from '../../src/settings/model';
function memory(){
  const files=new Map<string,Uint8Array>(),logs=new Map<string,string>();
  const store:Store={read:async p=>{const b=files.get(p);if(!b)throw new Error('Missing');return b.slice();},exists:async p=>files.has(p)||logs.has(p),
    create:async(p,b)=>{if(files.has(p))throw new Error('Collision');files.set(p,b.slice());},replace:async(p,b)=>{files.set(p,b.slice());},
    hiddenRead:async p=>{const t=logs.get(p);if(!t)throw new Error('Missing');return t;},hiddenWrite:async(p,t)=>{logs.set(p,t);},backup:async(p,b)=>{if(files.has(p))throw new Error('Collision');files.set(p,b.slice());}};
  const engine={destroy:vi.fn()};const compressor={engine,encode:vi.fn()}as unknown as Compressor;
  return {files,logs,store,batch:new BatchService(store,compressor),compressor};
}
async function item():Promise<Prepared>{const input=Uint8Array.of(1,2,3,4);return {path:'photo.jpg',input,fingerprint:await hash(input),settingsHash:'settings',encoded:{bytes:Uint8Array.of(5,6),before:{format:'jpeg',live:false,hdr:false,protected:[],capability:'static'},after:{format:'jpeg',live:false,hdr:false,protected:[],capability:'static'},backend:'test',warnings:[]}};}
it('copies without modifying the original; repeat target conflicts never overwrite',async()=>{
  const m=memory(),i=await item();m.files.set(i.path,i.input);const c=defaults();
  const logs=await m.batch.commit([i],c);expect(logs[0]?.state).toBe('committed');expect(m.files.get(i.path)).toEqual(i.input);expect(m.files.get('photo-compressed.jpg')).toEqual(i.encoded?.bytes);
  await expect(m.batch.commit([i],c)).rejects.toThrow('Copy target exists');expect(m.files.get('photo-compressed.jpg')).toEqual(i.encoded?.bytes);
});
it('rehashes after preview and refuses user-modified source',async()=>{
  const m=memory(),i=await item();m.files.set(i.path,Uint8Array.of(8));const logs=await m.batch.commit([i],defaults());expect(logs[0]?.state).toBe('failed');expect(m.files.has('photo-compressed.jpg')).toBe(false);
});
it('verifies backup before replacement and restores only an owned output',async()=>{
  const m=memory(),i=await item();m.files.set(i.path,i.input);const c={...defaults(),'compression.output':'replace'};
  const [j]=await m.batch.commit([i],c);expect(j?.state).toBe('committed');expect(m.files.get(j!.backup!)).toEqual(i.input);
  m.files.set(i.path,Uint8Array.of(99));await expect(m.batch.restore(j!,c)).rejects.toThrow('User modified');expect(m.files.get(i.path)).toEqual(Uint8Array.of(99));
  m.files.set(i.path,i.encoded!.bytes);await m.batch.restore(j!,c);expect(m.files.get(i.path)).toEqual(i.input);expect(j!.state).toBe('restored');
});
it('does not replace when backup readback is corrupted',async()=>{
  const m=memory(),i=await item();m.files.set(i.path,i.input);m.store.backup=async(p)=>{m.files.set(p,Uint8Array.of(99));};
  const [j]=await m.batch.commit([i],{...defaults(),'compression.output':'replace'});expect(j?.error).toContain('Backup readback failed');expect(m.files.get(i.path)).toEqual(i.input);
});
it('blocks reentry and honours cancellation while preparing',async()=>{
  const m=memory(),i=await item();i.path='photo.png';m.files.set(i.path,i.input);
  let resolve!:(v:unknown)=>void;m.compressor.encode=vi.fn(()=>new Promise(r=>{resolve=r;}))as Compressor['encode'];
  const task=m.batch.prepare([i.path],defaults());await vi.waitFor(()=>expect(m.compressor.encode).toHaveBeenCalled());
  await expect(m.batch.prepare([i.path],defaults())).rejects.toThrow('Batch already active');m.batch.cancel();resolve(i.encoded);await task;expect(m.batch.busy).toBe(false);expect(m.files.get(i.path)).toEqual(i.input);
});
it('skips a verified existing copy before encoding the same input and settings again',async()=>{
  const m=memory(),i=await item();i.path='photo.png';m.files.set(i.path,i.input);const c=defaults();
  i.settingsHash=await hash(new TextEncoder().encode(JSON.stringify(c)));await m.batch.commit([i],c);
  const prepared=await m.batch.prepare([i.path],c);expect(prepared[0]?.reason).toContain('Verified copy already exists');expect(m.compressor.encode).not.toHaveBeenCalled();
});
it('protects low disk reserve and never calls the encoder',async()=>{
  const m=memory(),i=await item();i.path='photo.png';m.files.set(i.path,i.input);m.store.availableBytes=async()=>1;
  const [prepared]=await m.batch.prepare([i.path],defaults());expect(prepared?.reason).toContain('Insufficient free space');expect(m.compressor.encode).not.toHaveBeenCalled();
});
it('corrupt existing history blocks preparation instead of forgetting owned transactions',async()=>{
  const m=memory(),i=await item();i.path='photo.png';m.files.set(i.path,i.input);m.logs.set('.live-media-reports/index.json','invalid');
  const [prepared]=await m.batch.prepare([i.path],defaults());expect(prepared?.reason).toContain('history cannot be verified');expect(m.compressor.encode).not.toHaveBeenCalled();
});
it('damaged saved output retains original backup and can recover a separate verified copy',async()=>{
  const m=memory(),i=await item();m.files.set(i.path,i.input);m.store.replace=async(p)=>{m.files.set(p,Uint8Array.of(9));};
  const c={...defaults(),'compression.output':'replace'};const [j]=await m.batch.commit([i],c);expect(j?.state).toBe('failed');
  await expect(m.batch.restore(j!,c)).rejects.toThrow('User modified');await m.batch.recoverCopy(j!,'recovered.jpg');expect(m.files.get('recovered.jpg')).toEqual(i.input);expect(m.files.get(i.path)).toEqual(Uint8Array.of(9));
});
it('batch resolves frozen per-media encoding preferences and rejects incomplete Apple groups',async()=>{
  const m=memory(),i=await item();i.path='photo.png';m.files.set(i.path,i.input);m.compressor.encode=vi.fn(async()=>i.encoded!)as Compressor['encode'];
  await m.batch.prepare([i.path],defaults(),undefined,()=>({...defaults(),'compression.jpegQuality':70}));expect(m.compressor.encode).toHaveBeenCalledWith(i.input,'png',expect.objectContaining({'compression.jpegQuality':70}),expect.any(AbortSignal));
  i.group='group';await expect(m.batch.commit([i],defaults())).rejects.toThrow('Incomplete Apple');
});

it('large batches release original bytes and re-read a verified original for replacement',async()=>{
  const m=memory(),i=await item();m.compressor.encode=vi.fn(async()=>i.encoded!)as Compressor['encode'];
  const input=new Uint8Array(700000).fill(9);for(let n=0;n<6;n++)m.files.set('photo'+n+'.png',input.slice());
  const c={...defaults(),'performance.cacheMiB':1,'performance.maxInputMiB':1};
  const prepared=await m.batch.prepare([...m.files.keys()],c);expect(prepared.every(p=>p.encoded&&p.input.length===0&&p.inputBytes===input.length)).toBe(true);
  const logs=await m.batch.commit([prepared[0]!],{...c,'compression.output':'replace'});
  expect(logs[0]?.state).toBe('committed');expect(m.files.get(logs[0]!.backup!)).toEqual(input);
});
