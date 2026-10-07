// SPDX-License-Identifier: GPL-3.0-only
import type {EditorView} from '@codemirror/view';
import type {HostManager,HostSession} from './host';
/** Never mutate editor DOM during a CodeMirror constructor/update transaction.
 * Late file information and asynchronous image widgets both retry attachment. */
export class EditorBinding {
  private session?:HostSession;private source?:string;private closed=false;private pending=false;
  private observer:MutationObserver;private retries:Array<ReturnType<typeof setTimeout>>=[];
  constructor(private view:EditorView,private manager:HostManager,private path:()=>string|undefined){
    this.observer=new MutationObserver(()=>this.refresh());
    this.observer.observe(view.dom,{subtree:true,childList:true,attributes:true,attributeFilter:['src','srcset']});
    this.refresh();
    for(const ms of [16,100,300,1000,3000])this.retries.push(setTimeout(()=>this.refresh(),ms));
  }
  refresh():void {if(this.closed||this.pending)return;this.pending=true;queueMicrotask(()=>{
    this.pending=false;if(this.closed)return;const source=this.path();
    if(source!==this.source){this.session?.destroy();this.session=undefined;this.source=source;}
    if(source&&!this.session)this.session=this.manager.attach(this.view.dom,source,'preview');
    this.session?.rescan();
  });}
  destroy():void {this.closed=true;this.observer.disconnect();for(const t of this.retries)clearTimeout(t);this.session?.destroy();}
}
