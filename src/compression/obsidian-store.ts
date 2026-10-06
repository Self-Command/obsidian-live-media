// SPDX-License-Identifier: GPL-3.0-only
import {TFile,FileSystemAdapter,Platform,type App} from 'obsidian';
import {safePath} from '../settings/model';
import type {Store} from './batch';
export class VaultStore implements Store {
  constructor(private app:App){}
  async read(path:string):Promise<Uint8Array>{return new Uint8Array(await this.app.vault.adapter.readBinary(safePath(path,true)));}
  async exists(path:string):Promise<boolean>{return this.app.vault.adapter.exists(safePath(path,true));}
  private async parents(path:string):Promise<void>{
    const parts=path.split('/');parts.pop();let folder='';
    for(const p of parts){folder=folder?folder+'/'+p:p;if(!await this.exists(folder))await this.app.vault.adapter.mkdir(folder);}
  }
  async create(path:string,bytes:Uint8Array):Promise<void>{safePath(path);if(await this.exists(path))throw new Error('Existing target');await this.parents(path);await this.app.vault.createBinary(path,bytes.slice().buffer);}
  async replace(path:string,bytes:Uint8Array,keepTimes:boolean):Promise<void>{safePath(path);const f=this.app.vault.getAbstractFileByPath(path);if(!(f instanceof TFile))throw new Error('Missing file');
    const time=keepTimes?{ctime:f.stat.ctime,mtime:f.stat.mtime}:undefined;await this.app.vault.modifyBinary(f,bytes.slice().buffer,time);}
  async hiddenRead(path:string):Promise<string>{return this.app.vault.adapter.read(safePath(path,true));}
  async hiddenWrite(path:string,text:string):Promise<void>{safePath(path,true);await this.parents(path);await this.app.vault.adapter.write(path,text);}
  async backup(path:string,bytes:Uint8Array):Promise<void>{safePath(path,true);if(await this.exists(path))throw new Error('Backup collision');await this.parents(path);await this.app.vault.adapter.writeBinary(path,bytes.slice().buffer);}
  async availableBytes():Promise<number|undefined>{
    if(!Platform.isDesktopApp||!(this.app.vault.adapter instanceof FileSystemAdapter))return undefined;
    try{const fs=await import('node:fs/promises');const stat=await fs.statfs(this.app.vault.adapter.getBasePath());return stat.bavail*stat.bsize;}catch{return undefined;}
  }
}
