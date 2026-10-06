// SPDX-License-Identifier: GPL-3.0-only
import {hash, equal} from '../media/bytes';
import {safePath, type Config} from '../settings/model';
import {Compressor, ProtectedMedia, type Encoded} from './encode';
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
  state:State;output:'copy'|'replace';timestamp:number;settingsHash:string;error?:string;
}
export interface Prepared {path:string;input:Uint8Array;fingerprint:string;encoded?:Encoded;reason?:string;settingsHash:string}
export class BatchService {
  busy=false;private controller?:AbortController;
  constructor(private store:Store,private compressor:Compressor){}
  cancel():void{this.controller?.abort();this.compressor.engine.destroy();}
  async prepare(paths:string[],config:Config,onProgress?:(item:Prepared)=>void):Promise<Prepared[]> {
    if(this.busy)throw new Error('Batch already active');this.busy=true;this.controller=new AbortController();
    const result:Prepared[]=[];const settingsHash=await hash(new TextEncoder().encode(JSON.stringify(config)));
    let previewBytes=0;const previewBudget=Math.max(Number(config['performance.cacheMiB'])*1048576,Number(config['performance.maxInputMiB'])*1048576*2);
    try{
      for(const path of [...new Set(paths)]){
        if(this.controller.signal.aborted)break;safePath(path);
        const item:Prepared={path,input:new Uint8Array(),fingerprint:'',settingsHash};
        try{
          item.input=await this.store.read(path);item.fingerprint=await hash(item.input);
          if(previewBytes+item.input.length*2>previewBudget){item.input=new Uint8Array();throw new ProtectedMedia('Batch preview memory budget reached; select a smaller range');}
          const free=await this.store.availableBytes?.();
          if(free!==undefined&&free<item.input.length*4+Number(config['storage.diskReserveMiB'])*1048576)throw new ProtectedMedia('Insufficient free space reserve');
          const history=await this.findHistory(path,config);
          if(config['compression.repeated']==='skip-owned'&&history.some(j=>j.state==='committed'&&j.outputHash===item.fingerprint))throw new ProtectedMedia('Previously compressed by Live Media');
          item.encoded=await this.compressor.encode(item.input,path.split('.').at(-1)!,config,this.controller.signal);
          previewBytes+=item.input.length+item.encoded.bytes.length;
        }catch(e){item.reason=String(e);}
        if(!item.encoded)item.input=new Uint8Array();
        result.push(item);onProgress?.(item);
      }return result;
    }finally{this.busy=false;this.controller=undefined;}
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
    try{index=JSON.parse(await this.store.hiddenRead(indexPath));}catch{/* first transaction */}
    if(!index.includes(j.id)){index.push(j.id);await this.store.hiddenWrite(indexPath,JSON.stringify(index));}
  }
  async commit(items:Prepared[],config:Config):Promise<Journal[]> {
    if(this.busy)throw new Error('Batch already active');this.busy=true;this.controller=new AbortController();const logs:Journal[]=[];
    try{
      for(const item of items){
        if(this.controller.signal.aborted)break;if(!item.encoded)continue;
        const output=config['compression.output'] as 'copy'|'replace';
        const target=output==='replace'?item.path:await this.copyTarget(item.path,config);
        const journal:Journal={version:1,id:crypto.randomUUID(),source:item.path,target,originalHash:item.fingerprint,outputHash:await hash(item.encoded.bytes),state:'prepared',output,timestamp:Date.now(),settingsHash:item.settingsHash};
        logs.push(journal);
        try{
          if(await hash(await this.store.read(item.path))!==item.fingerprint)throw new Error('Input changed after preview');
          if(output==='copy'&&await this.store.exists(target))throw new Error('Copy target exists');
          await this.log(journal,config);
          if(output==='replace'){
            journal.backup=safePath(String(config['storage.backupDirectory'])+'/'+journal.id+'/'+item.path,true);
            await this.store.backup(journal.backup,item.input);
            if(!equal(await this.store.read(journal.backup),item.input))throw new Error('Backup readback failed');
            journal.state='backed-up';await this.log(journal,config);
            if(await hash(await this.store.read(item.path))!==item.fingerprint)throw new Error('Input changed during backup');
          }
          if(this.controller.signal.aborted)throw new Error('Cancelled before write');
          journal.state='writing';await this.log(journal,config);
          if(output==='replace')await this.store.replace(target,item.encoded.bytes,!!config['compression.keepFileTimes']);
          else await this.store.create(target,item.encoded.bytes);
          if(await hash(await this.store.read(target))!==journal.outputHash)throw new Error('Saved output readback failed; check recovery report');
          journal.state='committed';await this.log(journal,config);
        }catch(e){journal.error=String(e);journal.state='failed';await this.log(journal,config);}
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
}
