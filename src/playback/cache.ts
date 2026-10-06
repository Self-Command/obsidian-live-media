// SPDX-License-Identifier: GPL-3.0-only
export class ByteCache {
  private entries=new Map<string,{data:Uint8Array;refs:number;used:number}>();
  private expiry=new Map<string,ReturnType<typeof setTimeout>>();
  constructor(public maxBytes:number,public maxEntries:number){}
  get bytes():number {return [...this.entries.values()].reduce((n,e)=>n+e.data.byteLength,0);}
  get(key:string):Uint8Array|undefined {const e=this.entries.get(key);if(e){e.used=Date.now();return e.data;}return undefined;}
  put(key:string,data:Uint8Array):boolean {if(data.length>this.maxBytes)return false;clearTimeout(this.expiry.get(key));this.expiry.delete(key);this.entries.set(key,{data,refs:0,used:Date.now()});this.prune();return this.entries.has(key);}
  retain(key:string,warmSeconds=0):()=>void {clearTimeout(this.expiry.get(key));this.expiry.delete(key);const e=this.entries.get(key);if(e)e.refs++;let released=false;return()=>{if(!released){released=true;if(e)e.refs=Math.max(0,e.refs-1);this.prune();
    if(e&&!e.refs)this.expiry.set(key,setTimeout(()=>{this.expiry.delete(key);if(this.entries.get(key)===e&&!e.refs)this.entries.delete(key);},warmSeconds*1000));}};}
  invalidate(prefix:string):void {for(const [key]of this.entries)if(key===prefix||key.startsWith(prefix+'\0')){this.entries.delete(key);clearTimeout(this.expiry.get(key));this.expiry.delete(key);}}
  prune():void {for(const [key,e]of [...this.entries].sort((a,b)=>a[1].used-b[1].used)){
    if(this.bytes<=this.maxBytes&&this.entries.size<=this.maxEntries)break;if(!e.refs)this.entries.delete(key);}}
  clear():void {this.entries.clear();for(const t of this.expiry.values())clearTimeout(t);this.expiry.clear();}
}
