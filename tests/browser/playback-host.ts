import type {Page} from '@playwright/test';
/** Downloaded production main.js, synthetic real Motion Photo, public API host.
 * This verifies lifecycle integration, not an actual Obsidian runtime. */
export async function installPlaybackHost(page:Page,auto=false):Promise<void>{
  await page.goto('/tests/browser/index.html');await page.addStyleTag({url:'/dist/styles.css'});
  await page.evaluate(async(auto)=>{
    const source=await(await fetch('/dist/main.js')).text(),bytes=await(await fetch('/dist/fixtures/motion.jpg')).arrayBuffer();
    const resource=URL.createObjectURL(new Blob([bytes]));const entries:any={post:[],extensions:[],events:[],writes:[]};
    class Component {
      private cleanups:Array<()=>void>=[];
      load(){}register(fn:()=>void){this.cleanups.push(fn);}
      registerDomEvent(el:EventTarget,name:string,fn:EventListener,options?:boolean|AddEventListenerOptions){el.addEventListener(name,fn,options);this.register(()=>el.removeEventListener(name,fn,options));}
      unload(){(this as any).onunload?.();for(const fn of this.cleanups.splice(0))fn();}
    }
    class MarkdownRenderChild extends Component{constructor(public containerEl:HTMLElement){super();}}
    class Plugin extends Component{
      app:any;async loadData(){return {global:{'auto.mode':auto?'every-enter':'off','auto.delayMs':0,'auto.cooldownMs':0,'auto.durationMs':1500,'diagnostics.level':'off'}};}
      async saveData(v:any){entries.writes.push(v);}addCommand(){}addSettingTab(){}registerEvent(){}
      registerMarkdownPostProcessor(fn:unknown){entries.post.push(fn);}registerEditorExtension(c:unknown){entries.extensions.push(c);}
    }
    class TFile{constructor(public path:string,public extension:string,public stat={mtime:1,size:bytes.byteLength,ctime:1}){}}
    const file=new TFile('media/motion.jpg','jpg'),note=new TFile('note.md','md'),infoField={},liveField={};
    const obs={Plugin,Modal:class{},FuzzySuggestModal:class{},Setting:class{},TFile,MarkdownView:class{},PluginSettingTab:class{},Notice:class{},Component,MarkdownRenderChild,Platform:{isDesktopApp:false,isIosApp:false,isAndroidApp:false},editorInfoField:infoField,editorLivePreviewField:liveField,FileSystemAdapter:class{}};
    const module={exports:{}as any};Function('require','module','exports',source)((name:string)=>name==='obsidian'?obs:name==='@codemirror/view'?{ViewPlugin:{fromClass:(c:unknown)=>c}}:(()=>{throw new Error('Unexpected dependency '+name);})(),module,module.exports);
    const plugin=new module.exports.default();plugin.app={vault:{adapter:{exists:async()=>false},getName:()=> 'CI-playback',getFiles:()=>[file,note],getAbstractFileByPath:(p:string)=>p===file.path?file:p===note.path?note:null,getResourcePath:(f:TFile)=>f===file?resource:resource+'-note',readBinary:async()=>bytes.slice(0),on:()=>({})},workspace:{containerEl:document.body,getLeavesOfType:()=>[],on:(name:string,fn:unknown)=>{entries.events.push({name,fn});return {}; }},metadataCache:{getFileCache:()=>({}),getFirstLinkpathDest:()=>file}};
    await plugin.onload();const image=()=>{const img=document.createElement('img');img.src=resource;img.width=240;img.height=240;return img;};
    Object.assign(window,{playbackHost:{plugin,entries,resource,file,note,image,infoField,liveField,close:()=>{plugin.unload();URL.revokeObjectURL(resource);}}});
  },auto);
}
