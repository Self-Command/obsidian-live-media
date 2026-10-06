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
    const obs={Plugin,Modal,Setting,PluginSettingTab,Notice,TFile:class{},Component,MarkdownRenderChild,Platform:{isDesktopApp:false,isIosApp:false,isAndroidApp:false},editorInfoField:{},FileSystemAdapter:class{}};
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
