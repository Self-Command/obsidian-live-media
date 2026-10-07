import {Plugin, Notice,Platform,TFile,MarkdownView,editorInfoField,editorLivePreviewField} from 'obsidian';
import {ViewPlugin,type EditorView,type ViewUpdate} from '@codemirror/view';
import {OfflineEngine} from './engine/client';
import {NativeEngine} from './engine/native';
import {SettingsModel} from './settings/model';
import {LiveSettingsTab,JsonModal} from './ui/settings';
import {ReferenceIndex} from './references/vault';
import {HostManager} from './playback/host';
import {Compressor} from './compression/encode';
import {BatchService} from './compression/batch';
import {VaultStore} from './compression/obsidian-store';
import {ScanModal,RecoveryModal} from './ui/batch';
import {probe} from './media/probe';
import type {ReferenceProvider} from './references/source';
import {Diagnostics} from './diagnostics';
import {RemoteMediaModal} from './ui/remote';
import {EditorBinding} from './playback/editor';
export default class LiveMedia extends Plugin {
  engine = new OfflineEngine();
  private model!:SettingsModel;private references!:ReferenceIndex;private hosts!:HostManager;private batch!:BatchService;
  private lastNotices=new Map<string,number>();private saveTimer?:ReturnType<typeof setTimeout>;
  private diagnostics?:Diagnostics;
  private notify=(message:string,kind:'error'|'summary'='error'):void=>{
    this.diagnostics?.record('error','runtime-media-warning');
    if(this.model?.effective()['diagnostics.notices']==='none')return;
    if(kind==='summary'&&this.model?.effective()['diagnostics.notices']==='errors')return;
    if(Date.now()-(this.lastNotices.get(message)??0)<5000)return;this.lastNotices.set(message,Date.now());new Notice(message);
  };
  private save=async()=>{await this.saveData(this.model.data);};
  override async onload(): Promise<void> {
    const platform=Platform.isIosApp?'ios':Platform.isAndroidApp?'android':'desktop';
    this.model=new SettingsModel(await this.loadData(),platform);this.references=new ReferenceIndex(this.app,()=>this.model.effective());
    this.hosts=new HostManager(this.app,this.model,this.references,this.notify,()=>{clearTimeout(this.saveTimer);this.saveTimer=setTimeout(()=>{void this.save();},300);});
    const store=new VaultStore(this.app);this.diagnostics=new Diagnostics(store,()=>this.model.effective());
    this.diagnostics.record('verbose','plugin-loaded');
    this.batch=new BatchService(store,new Compressor(this.engine,()=>{
      const c=this.model.effective();const path=String(c['native.executable']);
      if(!Platform.isDesktopApp||!c['native.enabled']||localStorage.getItem(this.nativeKey())!==path)return undefined;
      return new NativeEngine(path,()=>localStorage.getItem(this.nativeKey())===path);
    }));
    void this.batch.recovery(this.model.effective()).then(logs=>{
      if(logs.some(j=>['backed-up','writing','failed'].includes(j.state)))this.notify('Live Media 有未完成替换记录，请运行“检查日志并恢复原件”。不会自动继续写入。','summary');
    }).catch(()=>this.notify('Live Media 的历史报告无法验证，请检查恢复目录。'));
    this.addSettingTab(new LiveSettingsTab(this.app,this,this.model,this.save,clear=>{if(clear)this.hosts.clearPreviewed();this.hosts.settingsChanged();}));
    this.registerMarkdownPostProcessor((el,ctx)=>{ctx.addChild(this.hosts.attach(el,ctx.sourcePath,el.closest('.cm-editor')?'preview':'reading'));});
    const manager=this.hosts;
    const app=this.app;const bindings=new Set<EditorBinding>();
    this.registerEditorExtension(ViewPlugin.fromClass(class {
      private binding:EditorBinding;
      constructor(view:EditorView){this.binding=new EditorBinding(view,manager,()=>{
        if(view.state.field(editorLivePreviewField,false)===false)return undefined;
        const source=view.state.field(editorInfoField,false)?.file?.path;if(source)return source;
        const leaf=app.workspace.getLeavesOfType?.('markdown').find(leaf=>leaf.view instanceof MarkdownView&&leaf.view.containerEl.contains(view.dom));
        return leaf?.view instanceof MarkdownView?leaf.view.file?.path:undefined;
      });bindings.add(this.binding);}
      update(_update:ViewUpdate):void{this.binding.refresh();}
      destroy():void{bindings.delete(this.binding);this.binding.destroy();}
    }));
    const refreshEditors=()=>{for(const binding of bindings)binding.refresh();};
    this.registerEvent(this.app.workspace.on('layout-change',refreshEditors));
    this.registerEvent(this.app.workspace.on('file-open',refreshEditors));
    this.registerEvent(this.app.workspace.on('active-leaf-change',refreshEditors));
    this.register(()=>{for(const binding of bindings)binding.destroy();bindings.clear();});
    this.hosts.watchViewers(this.app.workspace.containerEl?.ownerDocument??document);
    this.registerEvent(this.app.vault.on('modify',f=>this.hosts.invalidate(f.path)));
    this.registerEvent(this.app.vault.on('create',()=>this.references.invalidate()));
    this.registerEvent(this.app.vault.on('delete',f=>{this.references.invalidate();this.hosts.invalidate(f.path);delete this.model.data.photos[f.path];}));
    this.registerEvent(this.app.vault.on('rename',(f,old)=>{
      this.hosts.invalidate(old);this.hosts.invalidate(f.path);
      this.references.invalidate();
      if(this.model.data.photos[old]){this.model.data.photos[f.path]=this.model.data.photos[old]!;delete this.model.data.photos[old];}
      for(const p of (this.model.data.global['pairing.explicit']??[])as Array<{photo:string;video:string}>){if(p.photo===old)p.photo=f.path;if(p.video===old)p.video=f.path;}
      void this.save();
    }));
    this.registerEvent(this.app.workspace.on('file-menu',(menu,file)=>{if(file instanceof TFile&&this.references.eligible(file))menu.addItem(item=>item.setTitle('Live Media · 检查并压缩').setIcon('image').onClick(()=>new ScanModal(this.app,this.references,this.batch,(path,note)=>this.model.effective(path,note),[file]).open()));}));
    this.addCommand({id:'compress-current-note',name:'检查并压缩当前文章图片 / Compress note media',callback:()=>new ScanModal(this.app,this.references,this.batch,(path,note)=>({...this.model.effective(path,note),'compression.defaultScope':'current-note'})).open()});
    this.addCommand({id:'compress-vault',name:'检查并压缩全库图片 / Scan vault media',callback:()=>new ScanModal(this.app,this.references,this.batch,(path,note)=>({...this.model.effective(path,note),'compression.defaultScope':'vault'})).open()});
    this.addCommand({id:'restore-originals',name:'检查日志并恢复原件 / Restore originals',callback:()=>new RecoveryModal(this.app,this.batch,this.model.effective()).open()});
    this.addCommand({id:'inspect-note-media',name:'检查当前文章媒体格式 / Inspect media',callback:()=>{void this.inspect();}});
    this.addCommand({id:'export-diagnostics',name:'查看脱敏诊断 / View diagnostics',callback:()=>new JsonModal(this.app,'Live Media · Diagnostics',this.diagnostics!.report()).open()});
    this.addCommand({id:'inspect-remote-media',name:'手动检查远程照片 / Inspect remote photo',callback:()=>{
      if(!this.model.effective()['network.remote']){this.notify('先开启手动远程读取；自动播放不会联网。');return;}
      new JsonModal(this.app,'确认远程照片 URL / Confirm remote URL','https://',async text=>{
        const url=new URL(text);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('Use HTTP(S) without embedded credentials');
        new RemoteMediaModal(this.app,url,this.model.effective()).open();
      }).open();
    }});
    this.addCommand({id:'stop-playback',name:'停止所有照片播放 / Stop playback',callback:()=>this.hosts.coordinator.stopAll()});
    this.addCommand({id:'authorize-native-engine',name:'授权本设备 FFmpeg / Authorize native FFmpeg',callback:()=>{
      if(!Platform.isDesktopApp){this.notify('Native backend is desktop only');return;}
      const path=String(this.model.effective()['native.executable']);if(!path){this.notify('Set the executable path first');return;}
      new JsonModal(this.app,'仅本设备执行授权 / Local authorization',path+'\n确认允许 Live Media 以参数数组调用该程序。授权不写入同步设置。',async()=>{localStorage.setItem(this.nativeKey(),path);this.model.set('native.enabled',true);await this.save();}).open();
    }});
    this.addCommand({id: 'offline-engine-check', name: 'Check offline engine', callback: () => {
      void this.engine.load().then(() => new Notice('Offline engines loaded')).catch(e => new Notice(String(e)));
    }});
  }
  registerReferenceProvider(provider:ReferenceProvider):()=>void{return this.references.register(provider);}
  private nativeKey():string{return 'live-media-native:'+this.app.vault.getName();}
  private async inspect():Promise<void>{
    const file=this.app.workspace.getActiveFile();if(!file){this.notify('Open a note first');return;}
    const refs=await this.references.note(file,new AbortController().signal);const output=[];
    for(const ref of refs){if(!ref.path)continue;const f=this.app.vault.getAbstractFileByPath(ref.path);if(!(f instanceof TFile)||!this.references.eligible(f))continue;
      const details=f.stat.size>Number(this.model.effective()['performance.maxInputMiB'])*1048576?{protected:['Input budget exceeded']}:probe(new Uint8Array(await this.app.vault.readBinary(f)));
      output.push({file:this.model.effective()['diagnostics.publicPaths']==='relative'?f.path:'[redacted]',evidence:ref.evidence,...details,xmp:undefined});}
    new JsonModal(this.app,'Live Media · 媒体检查',JSON.stringify({version:1,media:output},null,2)).open();
  }
  override onunload(): void {clearTimeout(this.saveTimer);this.batch?.cancel();this.hosts?.destroy();this.references?.destroy();this.engine.destroy();}
}
