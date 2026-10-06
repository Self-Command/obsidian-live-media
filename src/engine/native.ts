// SPDX-License-Identifier: GPL-3.0-only
import {OfflineEngine} from './client';
export class NativeEngine extends OfflineEngine {
  private kill?:()=>void;
  constructor(private executable:string,private authorized:()=>boolean){super();}
  override async load():Promise<void>{if(!this.authorized())throw new Error('Native execution not authorized on this device');}
  override async encode(input:Uint8Array,extension:string,args:string[],outputExtension=extension):Promise<Uint8Array>{
    await this.load();
    if(!/^[a-z0-9]{1,5}$/.test(extension)||!/^[a-z0-9]{1,5}$/.test(outputExtension))throw new Error('Invalid extension');
    const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
    const temp=await fs.mkdtemp(path.join(os.tmpdir(),'live-media-'));
    const source=path.join(temp,'input.'+extension),target=path.join(temp,'output.'+outputExtension);
    try{
      await fs.writeFile(source,input);
      const argv=args.map(v=>v==='$INPUT'?source:v==='$OUTPUT'?target:v);
      await this.execute(argv);return new Uint8Array(await fs.readFile(target));
    }finally{await fs.rm(temp,{recursive:true,force:true});}
  }
  private async execute(args:string[]):Promise<void>{
    const {spawn}=await import('node:child_process');
    await new Promise<void>((resolve,reject)=>{
      const child=spawn(this.executable,['-nostdin',...args],{shell:false,windowsHide:true,stdio:['ignore','ignore','pipe']});
      let tail='';child.stderr.on('data',(b:Buffer)=>{tail=(tail+b.toString()).slice(-2048);});
      const timer=setTimeout(()=>{child.kill();reject(new Error('Native encoding timeout'));},180000);
      this.kill=()=>{child.kill();reject(new Error('Cancelled'));};
      child.once('error',e=>{clearTimeout(timer);this.kill=undefined;reject(e);});
      child.once('close',code=>{clearTimeout(timer);this.kill=undefined;if(code===0)resolve();else reject(new Error('Native FFmpeg failed: '+tail));});
    });
  }
  override async validate(input:Uint8Array):Promise<void>{
    await this.encode(input,'mp4',['-v','error','-i','$INPUT','-map','0:v:0','-map','0:a?','-f','framehash','$OUTPUT'],'txt');
  }
  override destroy():void{this.kill?.();this.kill=undefined;}
}
