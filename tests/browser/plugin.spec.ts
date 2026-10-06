import {test,expect} from '@playwright/test';
test('downloaded main.js registers public plugin entries, loads settings and unloads without writes',async({page})=>{
  await page.goto('/tests/browser/index.html');
  const result=await page.evaluate(async()=>{
    const source=await(await fetch('/dist/main.js')).text();
    const entries:any={commands:[],post:[],extensions:[],events:[],tabs:[],writes:[]};
    class Component {load(){}unload(){(this as any).onunload?.();}register(){} }
    class MarkdownRenderChild extends Component{constructor(public containerEl:HTMLElement){super();}}
    class Plugin extends Component {
      app:any;async loadData(){return {global:{'auto.mode':'off','diagnostics.level':'off'}};}async saveData(v:unknown){entries.writes.push(v);}
      addCommand(c:unknown){entries.commands.push(c);}addSettingTab(t:unknown){entries.tabs.push(t);}
      registerMarkdownPostProcessor(p:unknown){entries.post.push(p);}registerEditorExtension(e:unknown){entries.extensions.push(e);}registerEvent(e:unknown){entries.events.push(e);}
    }
    class Modal{}class Setting{}class PluginSettingTab{constructor(..._:unknown[]){} }class Notice{}
    const obs={Plugin,Modal,FuzzySuggestModal:Modal,Setting,PluginSettingTab,Notice,TFile:class{},Component,MarkdownRenderChild,Platform:{isDesktopApp:false,isIosApp:false,isAndroidApp:false},editorInfoField:{},FileSystemAdapter:class{}};
    const module={exports:{}as any};
    Function('require','module','exports',source)((name:string)=>{if(name==='obsidian')return obs;if(name==='@codemirror/view')return {ViewPlugin:{fromClass:(c:unknown)=>c}};throw new Error('Unexpected runtime dependency '+name);},module,module.exports);
    const plugin=new module.exports.default();plugin.app={
      vault:{adapter:{exists:async()=>false},getName:()=> 'CI-smoke',getFiles:()=>[],getMarkdownFiles:()=>[],on:()=>({})},
      workspace:{on:()=>({})},metadataCache:{}};
    await plugin.onload();await Promise.resolve();
    const ids=entries.commands.map((c:any)=>c.id);plugin.onunload();
    return {ids,post:entries.post.length,extensions:entries.extensions.length,tabs:entries.tabs.length,writes:entries.writes.length};
  });
  expect(result.ids).toContain('compress-current-note');expect(result.ids).toContain('restore-originals');expect(result.ids).toContain('inspect-remote-media');
  expect(result.post).toBe(1);expect(result.extensions).toBe(1);expect(result.tabs).toBe(1);expect(result.writes).toBe(0);
});
test('downloaded plugin enhances asynchronous gallery images and disables them immediately via settings',async({page})=>{
  await page.goto('/tests/browser/index.html');
  await page.evaluate(async()=>{
    const source=await(await fetch('/dist/main.js')).text(),bytes=await(await fetch('/dist/fixtures/motion.jpg')).arrayBuffer();
    const resource=URL.createObjectURL(new Blob([bytes]));const entries:any={post:[],disposers:[]};
    class Component{load(){}register(fn:()=>void){entries.disposers.push(fn);}unload(){(this as any).onunload?.();}}
    class MarkdownRenderChild extends Component{constructor(public containerEl:HTMLElement){super();}}
    class Plugin extends Component{app:any;async loadData(){return {global:{'auto.mode':'off','diagnostics.level':'off'}};}async saveData(){}addCommand(){}addSettingTab(){}registerEvent(){}registerEditorExtension(){}registerMarkdownPostProcessor(fn:unknown){entries.post.push(fn);}}
    class Modal{}class Setting{}class TFile{constructor(public path:string,public extension:string,public stat={mtime:1,size:bytes.byteLength,ctime:1}){}}
    const obs={Plugin,Modal,FuzzySuggestModal:Modal,Setting,TFile,PluginSettingTab:class{},Notice:class{},Component,MarkdownRenderChild,Platform:{isDesktopApp:false,isIosApp:false,isAndroidApp:false},editorInfoField:{},FileSystemAdapter:class{}};
    const module={exports:{}as any};Function('require','module','exports',source)((name:string)=>name==='obsidian'?obs:name==='@codemirror/view'?{ViewPlugin:{fromClass:(c:unknown)=>c}}:(()=>{throw new Error('Unexpected dependency');})(),module,module.exports);
    const plugin=new module.exports.default(),file=new TFile('media/motion.jpg','jpg'),note=new TFile('note.md','md');
    plugin.app={vault:{adapter:{exists:async()=>false},getName:()=> 'CI-gallery',getFiles:()=>[file,note],getAbstractFileByPath:(p:string)=>p===file.path?file:p===note.path?note:null,getResourcePath:(f:TFile)=>f===file?resource:resource+'-note',readBinary:async()=>bytes.slice(0),on:()=>({})},workspace:{on:()=>({})},metadataCache:{getFileCache:()=>({}),getFirstLinkpathDest:()=>file}};
    await plugin.onload();const root=document.createElement('div');root.className='simple-gallery-container';document.body.append(root);
    entries.post[0](root,{sourcePath:'note.md',addChild:()=>{}});
    const img=document.createElement('img');img.src=resource;img.style.width='128px';img.style.height='128px';root.append(img);await img.decode();
    Object.assign(window,{galleryPlugin:{plugin,root,img,resource,entries}});
  });
  await expect(page.locator('video')).toHaveCount(1);
  await page.evaluate(()=>{const t=(window as any).galleryPlugin;t.plugin.model.set('render.gallery',false);t.plugin.hosts.settingsChanged();});await expect(page.locator('video')).toHaveCount(0);await expect(page.locator('img')).toHaveCount(1);
  await page.evaluate(()=>{const t=(window as any).galleryPlugin;t.plugin.model.set('render.gallery',true);t.plugin.hosts.settingsChanged();});await expect(page.locator('video')).toHaveCount(1);
  await page.evaluate(()=>{const t=(window as any).galleryPlugin;t.plugin.onunload();t.entries.disposers.forEach((fn:()=>void)=>fn());URL.revokeObjectURL(t.resource);});await expect(page.locator('video')).toHaveCount(0);
});
