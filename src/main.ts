import {Plugin, Notice,Platform,TFile,editorInfoField} from 'obsidian';
import {ViewPlugin,type EditorView} from '@codemirror/view';
import {OfflineEngine} from './engine/client';
import {SettingsModel} from './settings/model';
import {LiveSettingsTab,JsonModal} from './ui/settings';
import {ReferenceIndex} from './references/vault';
import {HostManager,type HostSession} from './playback/host';
import {Compressor} from './compression/encode';
import {BatchService} from './compression/batch';
import {VaultStore} from './compression/obsidian-store';
import {ScanModal,RecoveryModal} from './ui/batch';
import {probe} from './media/probe';
import type {ReferenceProvider} from './references/source';
export default class LiveMedia extends Plugin {
  engine = new OfflineEngine();
  private model!:SettingsModel;private references!:ReferenceIndex;private hosts!:HostManager;private batch!:BatchService;
  private lastNotices=new Map<string,number>();private saveTimer?:ReturnType<typeof setTimeout>;
  private notify=(message:string):void=>{
    if(this.model?.effective()['diagnostics.notices']==='none')return;
    if(Date.now()-(this.lastNotices.get(message)??0)<5000)return;this.lastNotices.set(message,Date.now());new Notice(message);
  };
  private save=async()=>{await this.saveData(this.model.data);};
  override async onload(): Promise<void> {
    const platform=Platform.isIosApp?'ios':Platform.isAndroidApp?'android':'desktop';
    this.model=new SettingsModel(await this.loadData(),platform);this.references=new ReferenceIndex(this.app,()=>this.model.effective());
    this.hosts=new HostManager(this.app,this.model,this.references,this.notify,()=>{clearTimeout(this.saveTimer);this.saveTimer=setTimeout(()=>{void this.save();},300);});
    this.batch=new BatchService(new VaultStore(this.app),new Compressor(this.engine));
    this.addSettingTab(new LiveSettingsTab(this.app,this,this.model,this.save,()=>this.hosts.settingsChanged()));
    this.registerMarkdownPostProcessor((el,ctx)=>{ctx.addChild(this.hosts.attach(el,ctx.sourcePath,'reading'));});
    const manager=this.hosts;
    this.registerEditorExtension(ViewPlugin.fromClass(class {
      session?:HostSession;
      constructor(view:EditorView){const info=view.state.field(editorInfoField,false);if(info?.file)this.session=manager.attach(view.dom,info.file.path,'preview');}
      destroy():void{this.session?.destroy();}
    }));
    this.registerEvent(this.app.vault.on('modify',f=>this.hosts.invalidate(f.path)));
    this.registerEvent(this.app.vault.on('delete',f=>{this.hosts.invalidate(f.path);delete this.model.data.photos[f.path];}));
    this.registerEvent(this.app.vault.on('rename',(f,old)=>{
      this.hosts.invalidate(old);this.hosts.invalidate(f.path);
      if(this.model.data.photos[old]){this.model.data.photos[f.path]=this.model.data.photos[old]!;delete this.model.data.photos[old];}
      for(const p of (this.model.data.global['pairing.explicit']??[])as Array<{photo:string;video:string}>){if(p.photo===old)p.photo=f.path;if(p.video===old)p.video=f.path;}
      void this.save();
    }));
    this.registerEvent(this.app.workspace.on('file-menu',(menu,file)=>{if(file instanceof TFile&&this.references.eligible(file))menu.addItem(item=>item.setTitle('Live Media · 检查并压缩').setIcon('image').onClick(()=>new ScanModal(this.app,this.references,this.batch,()=>this.model.effective(),[file]).open()));}));
    this.addCommand({id:'compress-current-note',name:'检查并压缩当前文章图片 / Compress note media',callback:()=>new ScanModal(this.app,this.references,this.batch,()=>({...this.model.effective(),'compression.defaultScope':'current-note'})).open()});
    this.addCommand({id:'compress-vault',name:'检查并压缩全库图片 / Scan vault media',callback:()=>new ScanModal(this.app,this.references,this.batch,()=>({...this.model.effective(),'compression.defaultScope':'vault'})).open()});
    this.addCommand({id:'restore-originals',name:'检查日志并恢复原件 / Restore originals',callback:()=>new RecoveryModal(this.app,this.batch,this.model.effective()).open()});
    this.addCommand({id:'inspect-note-media',name:'检查当前文章媒体格式 / Inspect media',callback:()=>{void this.inspect();}});
    this.addCommand({id:'stop-playback',name:'停止所有照片播放 / Stop playback',callback:()=>this.hosts.coordinator.stopAll()});
    this.addCommand({id: 'offline-engine-check', name: 'Check offline engine', callback: () => {
      void this.engine.load().then(() => new Notice('Offline engines loaded')).catch(e => new Notice(String(e)));
    }});
  }
  registerReferenceProvider(provider:ReferenceProvider):()=>void{return this.references.register(provider);}
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
