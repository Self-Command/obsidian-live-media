import type {Config} from './settings/model';
import type {Store} from './compression/batch';
export class Diagnostics {
  private entries:Array<{time:number;level:'error'|'verbose';code:string}>=[];
  private serial=Promise.resolve();
  constructor(private store:Store,private settings:()=>Config){}
  record(level:'error'|'verbose',code:string):void{
    const c=this.settings();if(c['diagnostics.level']==='off'||(level==='verbose'&&c['diagnostics.level']!=='verbose'))return;
    // Codes, not arbitrary plugin errors, note text or photo bytes.
    this.entries.push({time:Date.now(),level,code});this.entries=this.entries.slice(-200);
    const content=JSON.stringify({version:1,entries:this.entries},null,2);
    this.serial=this.serial.then(()=>this.store.hiddenWrite(String(this.settings()['storage.reportDirectory'])+'/diagnostics.json',content)).catch(()=>{});
  }
  report():string{return JSON.stringify({version:1,entries:this.entries},null,2);}
}
