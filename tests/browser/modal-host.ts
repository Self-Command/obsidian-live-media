import {type Page} from '@playwright/test';
/** Public-API host fixture. isOpen is deliberately an own boolean, matching the
 * runtime collision reported by the user; it is not a public API to depend on. */
export async function installModalHost(page:Page,options:{failReviewOnce?:boolean;hold?:boolean;actualCodec?:boolean}={}):Promise<void>{
  await page.goto('/tests/browser/index.html');await page.addStyleTag({url:'/dist/styles.css'});
  await page.evaluate(async(options)=>{
    const source=await(await fetch('/dist/main.js')).text(),live=await(await fetch('/dist/fixtures/motion.jpg')).arrayBuffer();
    const entries:any={commands:[],modals:[],errors:[],notices:[],creates:[],encodes:[],events:[],failReviewOnce:!!options.failReviewOnce};
    const proto=HTMLElement.prototype as any;
    proto.empty=function(){this.replaceChildren();};proto.setText=function(text:string){this.textContent=text;};proto.addClass=function(...classes:string[]){this.classList.add(...classes);};
    proto.createEl=function(tag:string,options:any={}){const el=document.createElement(tag);if(options.text)el.textContent=options.text;if(options.cls)el.className=options.cls;for(const [name,value]of Object.entries(options.attr??{}))el.setAttribute(name,String(value));this.append(el);return el;};
    proto.createDiv=function(options:any={}){return this.createEl('div',typeof options==='string'?{cls:options}:options);};
    class Component{load(){}unload(){(this as any).onunload?.();}register(){} }
    class Plugin extends Component{app:any;async loadData(){return {global:{'auto.mode':'off','diagnostics.level':'off'}};}async saveData(){}addCommand(c:any){entries.commands.push(c);}addSettingTab(){}registerMarkdownPostProcessor(){}registerEditorExtension(){}registerEvent(){} }
    class Modal{
      isOpen=false;containerEl=document.createElement('section');titleEl=document.createElement('h2');contentEl=document.createElement('div');
      constructor(public app:any){this.containerEl.className='modal-host';this.containerEl.append(this.titleEl,this.contentEl);entries.modals.push(this);}
      open(){this.isOpen=true;document.body.append(this.containerEl);(this as any).onOpen?.();if(entries.failReviewOnce&&this.titleEl.textContent?.startsWith('3 ·')){entries.failReviewOnce=false;throw new Error('Synthetic review open failure');}}
      close(){if(!this.isOpen)return;this.isOpen=false;(this as any).onClose?.();this.containerEl.remove();}
    }
    class Setting{
      settingEl:HTMLElement;name:HTMLElement;desc:HTMLElement;
      constructor(parent:HTMLElement){this.settingEl=(parent as any).createDiv({cls:'setting-item'});this.name=(this.settingEl as any).createDiv();this.desc=(this.settingEl as any).createDiv();}
      setName(v:string){this.name.textContent=v;return this;}setDesc(v:string){this.desc.textContent=v;return this;}
      addButton(fn:any){const button=document.createElement('button');this.settingEl.append(button);const b:any={buttonEl:button,setButtonText(v:string){button.textContent=v;return b;},setCta(){return b;},setDisabled(v:boolean){button.disabled=v;return b;},onClick(fn:any){button.onclick=fn;return b;}};fn(b);return this;}
      addToggle(fn:any){const input=document.createElement('input');input.type='checkbox';this.settingEl.append(input);const t:any={setValue(v:boolean){input.checked=v;return t;},setDisabled(v:boolean){input.disabled=v;return t;},onChange(fn:any){input.onchange=()=>fn(input.checked);return t;}};fn(t);return this;}
      addDropdown(fn:any){const select=document.createElement('select');this.settingEl.append(select);const d:any={addOptions(items:any){for(const [value,label]of Object.entries(items)){const o=document.createElement('option');o.value=value;o.textContent=String(label);select.append(o);}return d;},setValue(v:string){select.value=v;return d;},onChange(fn:any){select.onchange=()=>fn(select.value);return d;}};fn(d);return this;}
    }
    class TFile{extension:string;basename:string;stat:any;constructor(public path:string,size=0){this.extension=path.split('.').at(-1)!;this.basename=path.split('/').at(-1)!.replace(/\.[^.]+$/,'');this.stat={mtime:1,ctime:1,size};}}
    class Notice{constructor(message:string){entries.notices.push(message);}}
    const obs={Plugin,Modal,FuzzySuggestModal:Modal,Setting,TFile,Notice,Component,MarkdownRenderChild:class extends Component{},PluginSettingTab:class{},Platform:{isDesktopApp:false,isIosApp:false,isAndroidApp:false},FileSystemAdapter:class{},editorInfoField:{}};
    const module={exports:{}as any};Function('require','module','exports',source)((name:string)=>name==='obsidian'?obs:name==='@codemirror/view'?{ViewPlugin:{fromClass:(c:any)=>c}}:(()=>{throw new Error(name);})(),module,module.exports);
    const canvas=document.createElement('canvas');canvas.width=384;canvas.height=256;const ctx=canvas.getContext('2d')!;const pixels=ctx.createImageData(canvas.width,canvas.height);
    for(let p=0;p<pixels.data.length;p+=4){pixels.data[p]=(p*37)%256;pixels.data[p+1]=(p*17)%251;pixels.data[p+2]=(p*7)%253;pixels.data[p+3]=255;}ctx.putImageData(pixels,0,0);
    const jpeg=await new Promise<ArrayBuffer>(resolve=>canvas.toBlob(async b=>resolve(await b!.arrayBuffer()),'image/jpeg',1));
    const media=new Map<string,ArrayBuffer>([['media/first.jpg',jpeg],['media/broken.jpg',Uint8Array.of(255,216,255).buffer],['media/live.jpg',live]]),originals=new Map([...media].map(([p,b])=>[p,new Uint8Array(b).join(',')]));
    const files=new Map([...media].map(([p,b])=>[p,new TFile(p,b.byteLength)])),note=new TFile('note.md');files.set(note.path,note);
    const text=[...media.keys()].map(p=>'![['+p+']]').join('\n'),logs=new Map<string,string>(),folders=new Set<string>();
    const adapter={exists:async(p:string)=>media.has(p)||logs.has(p)||folders.has(p),readBinary:async(p:string)=>{const b=media.get(p);if(!b)throw new Error('Missing media');return b.slice(0);},mkdir:async(p:string)=>{folders.add(p);},read:async(p:string)=>{if(!logs.has(p))throw new Error('Missing log');return logs.get(p)!;},write:async(p:string,v:string)=>{logs.set(p,v);},writeBinary:async()=>{throw new Error('No source replacement in UI acceptance');}};
    const plugin=new module.exports.default();plugin.app={vault:{adapter,getName:()=> 'CI-modal-host',getFiles:()=>[...files.values()],getMarkdownFiles:()=>[note],getAbstractFileByPath:(p:string)=>files.get(p)??null,getResourcePath:(f:TFile)=>'app://ci/'+f.path,cachedRead:async()=>text,read:async()=>text,readBinary:async(f:TFile)=>adapter.readBinary(f.path),createBinary:async(p:string,b:ArrayBuffer)=>{if(media.has(p))throw new Error('Copy exists');entries.creates.push(p);media.set(p,b);files.set(p,new TFile(p,b.byteLength));},on:()=>({})},workspace:{containerEl:document.body,getActiveFile:()=>note,getMostRecentLeaf:()=>({view:{containerEl:document.body}}),on:()=>({})},metadataCache:{getFileCache:()=>({}),getFirstLinkpathDest:(p:string)=>files.get(p)??null}};
    await plugin.onload();const compressor=plugin.batch.compressor,encode=compressor.encode.bind(compressor);
    compressor.encode=async(input:any,ext:any,c:any,signal:any)=>{
      entries.encodes.push(entries.encodes.length+1);
      if(options.hold&&entries.encodes.length===1)await new Promise<void>(resolve=>{entries.resume=resolve;signal.addEventListener('abort',()=>{entries.cancelled=true;resolve();},{once:true});});
      if(signal.aborted)throw new Error('Cancelled');
      if(options.actualCodec)return encode(input,ext,c,signal);
      const p={format:'jpeg',live:false,hdr:false,protected:[],capability:'static'};return {bytes:new Uint8Array(jpeg),before:p,after:p,backend:'UI fixture',warnings:[]};
    };
    Object.assign(window,{modalAcceptance:{plugin,entries,media,originals,unchanged:()=>[...originals].every(([p,b])=>new Uint8Array(media.get(p)!).join(',')===b),start:()=>entries.commands.find((c:any)=>c.id==='compress-current-note').callback(),close:()=>{for(const m of entries.modals)if(m.isOpen)m.close();plugin.onunload();}}});
    window.addEventListener('unhandledrejection',e=>entries.errors.push(String(e.reason)));
  },options);
}
