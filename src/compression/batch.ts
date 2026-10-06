// SPDX-License-Identifier: GPL-3.0-only
import {hash, equal} from '../media/bytes';
import {safePath, type Config} from '../settings/model';
import {Compressor, ProtectedMedia, type Encoded} from './encode';
import {applePhotoId} from '../media/exif';
import {probe,type MediaProbe} from '../media/probe';
export interface Store {
  read(path:string):Promise<Uint8Array>;
  exists(path:string):Promise<boolean>;
  create(path:string,bytes:Uint8Array):Promise<void>;
  replace(path:string,bytes:Uint8Array,keepTimes:boolean):Promise<void>;
  hiddenRead(path:string):Promise<string>;
  hiddenWrite(path:string,text:string):Promise<void>;
  backup(path:string,bytes:Uint8Array):Promise<void>;
  availableBytes?():Promise<number|undefined>;
}
export type State='prepared'|'backed-up'|'writing'|'committed'|'restored'|'conflict'|'failed';
export interface Journal {
  version:1;id:string;source:string;target:string;originalHash:string;outputHash:string;backup?:string;
  state:State;output:'copy'|'replace';timestamp:number;settingsHash:string;error?:string;group?:string;
}
export type PrepareStage='reading'|'checking'|'encoding';
export interface Prepared {path:string;input:Uint8Array;inputBytes?:number;fingerprint:string;encoded?:Encoded;reason?:string;outcome?:'protected'|'failed';settingsHash:string;group?:string}
export class BatchService {
  busy=false;private controller?:AbortController;
  constructor(private store:Store,private compressor:Compressor){}
  cancel():void{this.controller?.abort();this.compressor.engine.destroy();}
  async prepare(paths:string[],baseConfig:Config,onProgress?:(item:Prepared)=>void,configFor?:(path:string)=>Config,onStage?:(path:string,stage:PrepareStage)=>void):Promise<Prepared[]> {
    if(this.busy)throw new Error('Batch already active');this.busy=true;this.controller=new AbortController();
    const result:Prepared[]=[];
    const processed=new Set<string>();
    let previewBytes=0;const previewBudget=Math.max(Number(baseConfig['performance.cacheMiB'])*1048576,Number(baseConfig['performance.maxInputMiB'])*1048576*2);
    try{
      for(const path of [...new Set(paths)]){
        if(processed.has(path))continue;processed.add(path);
        if(this.controller.signal.aborted)break;safePath(path);
        const config=configFor?.(path)??baseConfig;const settingsHash=await hash(new TextEncoder().encode(JSON.stringify(config)));
        const item:Prepared={path,input:new Uint8Array(),fingerprint:'',settingsHash};
        try{
          onStage?.(path,'reading');item.input=await this.store.read(path);onStage?.(path,'checking');item.inputBytes=item.input.length;item.fingerprint=await hash(item.input);
          if(previewBytes+item.input.length*2>previewBudget){item.input=new Uint8Array();throw new ProtectedMedia('Batch preview memory budget reached; select a smaller range');}
          const free=await this.store.availableBytes?.();
          if(free!==undefined&&free<item.input.length*4+Number(config['storage.diskReserveMiB'])*1048576)throw new ProtectedMedia('Insufficient free space reserve');
          const history=await this.findHistory(path,config);
          if(config['compression.repeated']==='skip-owned')for(const j of history){
            if(j.state!=='committed')continue;
            if(j.outputHash===item.fingerprint)throw new ProtectedMedia('Previously compressed by Live Media');
            if(j.output==='copy'&&j.originalHash===item.fingerprint&&j.settingsHash===settingsHash&&await this.store.exists(j.target)&&await hash(await this.store.read(j.target))===j.outputHash)
              throw new ProtectedMedia('Verified copy already exists for this input and settings');
          }
          let apple:string|undefined;
          if(/\.jpe?g$/i.test(path))apple=applePhotoId(item.input);
          if(apple){
            if((config['compression.formats']as Record<string,unknown>)['apple-pair']===false)throw new ProtectedMedia('Apple pair route disabled');
            const pairs=config['pairing.explicit']as Array<{photo:string;video:string}>;
            let moviePath=pairs.find(p=>p.photo===path)?.video;
            if(!moviePath&&config['pairing.sameNameCandidates'])for(const ext of ['mov','MOV']){const candidate=path.replace(/\.[^.]+$/,'.'+ext);if(await this.store.exists(candidate)){moviePath=candidate;break;}}
            if(!moviePath)throw new ProtectedMedia('Apple movie candidate missing');
            const movie=await this.store.read(moviePath);if(previewBytes+(item.input.length+movie.length)*2>previewBudget)throw new ProtectedMedia('Pair exceeds preview budget');
            onStage?.(path,'encoding');const encoded=await this.compressor.encodeApple(item.input,movie,config,this.controller.signal);const group=crypto.randomUUID();item.group=group;
            const photoProbe=probe(item.input);
            item.encoded={bytes:encoded.photo,before:photoProbe,after:photoProbe,backend:'wasm',warnings:['Trusted Apple media group; static photo unchanged.']};
            const movieProbe:MediaProbe={format:'mov',live:true,hdr:false,protected:[],capability:'play-only'};
            const companion:Prepared={path:moviePath,input:new Uint8Array(),inputBytes:movie.length,fingerprint:await hash(movie),settingsHash,group,encoded:{bytes:encoded.movie,before:movieProbe,after:movieProbe,backend:'wasm',warnings:['Apple metadata/audio/timed samples verified; phone recognition still needs device acceptance.']}};
            result.push(companion);onProgress?.(companion);previewBytes+=encoded.movie.length;
            processed.add(moviePath);
          }else{onStage?.(path,'encoding');item.encoded=await this.compressor.encode(item.input,path.split('.').at(-1)!,config,this.controller.signal);}
          previewBytes+=item.encoded.bytes.length;
          item.input=new Uint8Array(); // Original is re-read and fingerprint-checked only when previewed or committed.
        }catch(e){item.reason=String(e);item.outcome=e instanceof ProtectedMedia?'protected':'failed';}
        if(!item.encoded)item.input=new Uint8Array();
        result.push(item);onProgress?.(item);
      }return result;
    }finally{this.busy=false;this.controller=undefined;}
  }
  async original(item:Prepared):Promise<Uint8Array>{
    const bytes=await this.store.read(item.path);
    if(await hash(bytes)!==item.fingerprint)throw new Error('Input changed after preview');
    return bytes;
  }
  private journalPath(id:string,c:Config):string{return safePath(String(c['storage.reportDirectory'])+'/'+id+'.json',true);}
  private async findHistory(path:string,c:Config):Promise<Journal[]>{
    const indexPath=String(c['storage.reportDirectory'])+'/index.json';if(!await this.store.exists(indexPath))return [];
    try{const index=JSON.parse(await this.store.hiddenRead(indexPath)) as string[];
      const result:Journal[]=[];for(const id of index){const j=JSON.parse(await this.store.hiddenRead(this.journalPath(id,c))) as Journal;if(j.source===path)result.push(j);}return result;
    }catch{throw new Error('Existing transaction history cannot be verified');}
  }
  private async log(j:Journal,c:Config):Promise<void>{
    await this.store.hiddenWrite(this.journalPath(j.id,c),JSON.stringify(j,null,2));
    const indexPath=String(c['storage.reportDirectory'])+'/index.json';let index:string[]=[];
    if(await this.store.exists(indexPath)){
      index=JSON.parse(await this.store.hiddenRead(indexPath));if(!Array.isArray(index)||index.some(id=>typeof id!=='string'||!/^[\w-]{1,64}$/.test(id)))throw new Error('Transaction index cannot be safely updated');
    }
    if(!index.includes(j.id)){index.push(j.id);await this.store.hiddenWrite(indexPath,JSON.stringify(index));}
  }
  async commit(items:Prepared[],config:Config,onProgress?:(journal:Journal)=>void):Promise<Journal[]> {
    if(this.busy)throw new Error('Batch already active');this.busy=true;this.controller=new AbortController();const logs:Journal[]=[];
    const units=new Map<string,Prepared[]>();
    for(const item of items)if(item.encoded){const key=item.group??item.path;const unit=units.get(key)??[];unit.push(item);units.set(key,unit);}
    try{
      for(const unit of units.values()){
        if(this.controller.signal.aborted)break;
        if(unit[0]!.group&&unit.length!==2)throw new Error('Incomplete Apple media group');
        const output=config['compression.output'] as 'copy'|'replace';
        const jobs:Array<{item:Prepared;journal:Journal}>=[];
        // Reserve and fingerprint-check every group member before any write.
        for(const item of unit){
          const target=output==='replace'?item.path:await this.copyTarget(item.path,config);
          if(jobs.some(job=>job.journal.target===target))throw new Error('Media group target collision');
          const journal:Journal={version:1,id:crypto.randomUUID(),source:item.path,target,originalHash:item.fingerprint,outputHash:await hash(item.encoded!.bytes),state:'prepared',output,timestamp:Date.now(),settingsHash:item.settingsHash,group:item.group};
          jobs.push({item,journal});logs.push(journal);
        }
        try{
          for(const {item,journal}of jobs){
            const original=await this.original(item);
            await this.log(journal,config);
            if(output==='replace'){
              journal.backup=safePath(String(config['storage.backupDirectory'])+'/'+journal.id+'/'+item.path,true);
              await this.store.backup(journal.backup,original);
              if(!equal(await this.store.read(journal.backup),original))throw new Error('Backup readback failed');
              journal.state='backed-up';await this.log(journal,config);
            }
          }
          // Both pair backups are now verified. Cancellation cannot leave half a committed pair.
          if(this.controller.signal.aborted)throw new Error('Cancelled before write');
          for(const {item,journal}of jobs){
            if(await hash(await this.store.read(item.path))!==item.fingerprint)throw new Error('Input changed during backup');
            if(output==='copy'&&await this.store.exists(journal.target))throw new Error('Copy target exists');
            journal.state='writing';await this.log(journal,config);
            if(output==='replace')await this.store.replace(journal.target,item.encoded!.bytes,!!config['compression.keepFileTimes']);
            else await this.store.create(journal.target,item.encoded!.bytes);
            if(await hash(await this.store.read(journal.target))!==journal.outputHash)throw new Error('Saved output readback failed; check recovery report');
            journal.state='committed';await this.log(journal,config);
          }
        }catch(error){
          // A failed group may have changed one member. Restore only a fingerprint we own.
          for(const {journal}of [...jobs].reverse()){
            const wasWritten=journal.state==='committed'||journal.state==='writing';
            if(jobs.length>1&&output==='replace'&&wasWritten&&journal.backup){
              try{
                if(await hash(await this.store.read(journal.source))!==journal.outputHash)throw new Error('Concurrent user change; group restoration blocked');
                const original=await this.store.read(journal.backup);if(await hash(original)!==journal.originalHash)throw new Error('Invalid group backup');
                await this.store.replace(journal.source,original,!!config['compression.keepFileTimes']);
                if(await hash(await this.store.read(journal.source))!==journal.originalHash)throw new Error('Group restore failed');
                journal.state='restored';
              }catch{journal.state='conflict';}
            }else journal.state='failed';
            journal.error=String(error);await this.log(journal,config);
          }
        }
        for(const {journal}of jobs)onProgress?.(journal);
      }return logs;
    }finally{this.busy=false;this.controller=undefined;}
  }
  private async copyTarget(path:string,c:Config):Promise<string>{
    const dot=path.lastIndexOf('.'),base=path.slice(0,dot),ext=path.slice(dot);const directory=c['storage.copyDirectory'];
    const stem=directory==='alongside'?base:String(directory)+'/'+base.split('/').at(-1);
    const target=safePath(stem+String(c['storage.copySuffix'])+ext);
    if(await this.store.exists(target))throw new Error('Copy target exists; choose another suffix');return target;
  }
  async recovery(config:Config):Promise<Journal[]>{
    const path=String(config['storage.reportDirectory'])+'/index.json';if(!await this.store.exists(path))return [];
    const index=JSON.parse(await this.store.hiddenRead(path)) as string[];if(!Array.isArray(index)||index.length>100000)throw new Error('Invalid transaction index');
    const result:Journal[]=[];for(const id of index){if(!/^[\w-]{1,64}$/.test(id))throw new Error('Invalid transaction ID');
      const j=JSON.parse(await this.store.hiddenRead(this.journalPath(id,config))) as Journal;
      if(j.version!==1||j.id!==id||!['copy','replace'].includes(j.output)||typeof j.source!=='string'||!/^\w{64}$/.test(j.originalHash)||!/^\w{64}$/.test(j.outputHash))throw new Error('Invalid transaction record');
      if(j.backup&&!j.backup.startsWith(String(config['storage.backupDirectory'])+'/'+id+'/'))throw new Error('Backup outside owned transaction');
      if(j.backup&&j.state!=='restored')result.push(j);
    }return result;
  }
  async restore(j:Journal,config:Config):Promise<void>{
    if(this.busy)throw new Error('Batch active');if(!j.backup)throw new Error('No original backup');safePath(j.source);safePath(j.backup,true);
    this.busy=true;
    try{
      const original=await this.store.read(j.backup);if(await hash(original)!==j.originalHash)throw new Error('Backup fingerprint mismatch');
      const current=await this.store.read(j.source);const fingerprint=await hash(current);
      if(fingerprint===j.originalHash){j.state='restored';await this.log(j,config);return;}
      if(fingerprint!==j.outputHash){j.state='conflict';await this.log(j,config);throw new Error('User modified this file; restore will not overwrite it');}
      // Recheck immediately before writing. DataAdapter has no cross-device compare-and-swap.
      if(await hash(await this.store.read(j.source))!==j.outputHash)throw new Error('Concurrent modification');
      await this.store.replace(j.source,original,!!config['compression.keepFileTimes']);
      if(await hash(await this.store.read(j.source))!==j.originalHash)throw new Error('Restore readback failed');
      j.state='restored';await this.log(j,config);
    }finally{this.busy=false;}
  }
  async recoverCopy(j:Journal,target:string):Promise<void>{
    if(this.busy)throw new Error('Batch active');if(!j.backup)throw new Error('No original backup');safePath(target);safePath(j.backup,true);
    if(target.split('.').at(-1)!==j.source.split('.').at(-1))throw new Error('Keep original extension');this.busy=true;
    try{const original=await this.store.read(j.backup);if(await hash(original)!==j.originalHash)throw new Error('Backup fingerprint mismatch');
      if(await this.store.exists(target))throw new Error('Recovery copy target exists');await this.store.create(target,original);
      if(await hash(await this.store.read(target))!==j.originalHash)throw new Error('Recovery copy readback failed');
    }finally{this.busy=false;}
  }
}
