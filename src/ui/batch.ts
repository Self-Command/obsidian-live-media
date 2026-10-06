// SPDX-License-Identifier: GPL-3.0-only
import {Modal,Setting,Notice,TFile,type App} from 'obsidian';
import type {ReferenceIndex} from '../references/vault';
import type {Reference} from '../references/source';
import type {BatchService,Prepared,Journal} from '../compression/batch';
import type {Config} from '../settings/model';
import {Photo,PlaybackCoordinator} from '../playback/photo';
export class ScanModal extends Modal {
  private abort=new AbortController();private selected=new Set<string>();private refs:Reference[]=[];
  private range:string;private shared=new Map<string,string[]>();private next=false;
  constructor(app:App,private index:ReferenceIndex,private batch:BatchService,private settings:()=>Config,private initial?:TFile[]){super(app);this.range=initial?.length?'selected-files':String(settings()['compression.defaultScope']);}
  override onOpen():void {this.contentEl.addClass('live-media');this.render();}
  private render():void {
    this.contentEl.empty();this.titleEl.setText('1 · 选择范围 / Select media');
    this.contentEl.createEl('p',{text:'扫描只读取文件。直接引用默认选中；动态展示和未知语法候选需要确认。共享原件会列出引用文章。'});
    new Setting(this.contentEl).setName('范围 · Scope').addDropdown(d=>d.addOptions({'current-note':'当前文章','selected-files':'选定文件','vault':'全库图片'}).setValue(this.range).onChange(v=>{this.range=v;void this.scan();}));
    const list=this.contentEl.createDiv({cls:'live-media-scan-list'});
    new Setting(this.contentEl).addButton(b=>b.setButtonText('下一步：编码预览').setCta().onClick(()=>{
      if(!this.selected.size){new Notice('Select at least one verified file');return;}
      this.next=true;const c={...this.settings()};const paths=[...this.selected];
      this.close();new PrepareModal(this.app,this.batch,paths,c).open();
    }));
    void this.scan(list);
  }
  private async scan(list=this.contentEl.querySelector<HTMLElement>('.live-media-scan-list')!):Promise<void>{
    list.empty();list.createEl('p',{text:'正在读取引用…'});this.selected.clear();this.refs=[];this.shared.clear();
    const c=this.settings();
    try{
      if(this.range==='current-note'){
        const file=this.app.workspace.getActiveFile();if(!file)throw new Error('Open a note first');
        const editor=this.app.workspace.activeEditor;
        if(editor?.file?.path===file.path&&editor.editor&&editor.editor.getValue()!==await this.app.vault.read(file))throw new Error('当前文章有未保存编辑。先保存，再重新检测，避免使用磁盘旧正文。');
        this.refs=await this.index.note(file,this.abort.signal);
        // Rendered nodes contribute dynamic identities only; do not promote them to source references.
        if(c['detect.rendered'])for(const img of (this.app.workspace.getMostRecentLeaf()?.view.containerEl??this.app.workspace.containerEl).querySelectorAll<HTMLImageElement>('img')){
          const ref=this.index.rendered(img,file.path);if(ref.path)this.refs.push(ref);
        }
        if(c['scope.embeddedNotes'])for(const ref of [...this.refs]){
          const target=ref.path?this.app.vault.getAbstractFileByPath(ref.path):null;
          if(target instanceof TFile&&target.extension==='md')this.refs.push(...await this.index.note(target,this.abort.signal));
        }
      }else{
        const files=this.range==='selected-files'?(this.initial??[]):this.app.vault.getFiles();
        if(!files.length&&this.range==='selected-files'){
          const active=this.app.workspace.getActiveFile();if(active)files.push(active);
        }
        for(const file of files)if(this.index.eligible(file))this.refs.push({path:file.path,link:file.path,source:'',evidence:'direct',origin:this.range,offset:0});
      }
      const unique=new Map<string,Reference>();
      for(const ref of this.refs){if(!ref.path)continue;const file=this.app.vault.getAbstractFileByPath(ref.path);if(!(file instanceof TFile)||!this.index.eligible(file))continue;
        if(!unique.has(ref.path)||ref.evidence==='direct')unique.set(ref.path,ref);}
      const refs=[...unique.values()];
      if(c['scope.order']==='path'||this.range!=='current-note')refs.sort((a,b)=>a.path!.localeCompare(b.path!));
      if(c['scope.order']==='size-desc')refs.sort((a,b)=>(this.app.vault.getAbstractFileByPath(b.path!)as TFile).stat.size-(this.app.vault.getAbstractFileByPath(a.path!)as TFile).stat.size);
      // Shared use includes source parsing, so gallery references are counted as well.
      for(const note of this.app.vault.getMarkdownFiles()){
        if(this.abort.signal.aborted)return;
        for(const ref of await this.index.note(note,this.abort.signal))if(ref.path&&unique.has(ref.path)&&ref.evidence==='direct'){
          const sources=this.shared.get(ref.path)??[];if(!sources.includes(note.path))sources.push(note.path);this.shared.set(ref.path,sources);
        }
      }
      if(this.abort.signal.aborted)return;list.empty();
      if(!refs.length){list.createEl('p',{text:'没有可处理的库内图片。选定文件范围使用文件菜单；未知 URL 不猜测原件。'});return;}
      for(const ref of refs){const path=ref.path!,shared=this.shared.get(path)??[];const skip=shared.length>1&&c['compression.includeShared']==='skip';
        const chosen=!skip&&shared.length<=1&&(ref.evidence==='direct'||(ref.evidence==='dynamic'&&!!c['scope.dynamicSelected']));if(chosen)this.selected.add(path);
        const row=new Setting(list).setName(path).setDesc(`${ref.evidence} · ${ref.origin}${shared.length>1?' · 共享于 '+shared.join(', '):''}${skip?' · 已按设置跳过':''}`);
        row.addToggle(t=>t.setValue(chosen).setDisabled(skip).onChange(v=>{if(v)this.selected.add(path);else this.selected.delete(path);}));
      }
    }catch(e){if(!this.abort.signal.aborted){list.empty();list.createEl('p',{text:String(e)});}}
  }
  override onClose():void {this.abort.abort();this.contentEl.empty();}
}
class PrepareModal extends Modal {
  private allowClose=false;
  constructor(app:App,private batch:BatchService,private paths:string[],private config:Config){super(app);}
  override onOpen():void {
    this.contentEl.addClass('live-media');this.titleEl.setText('2 · 临时编码 / Prepare comparison');
    this.contentEl.createEl('p',{text:'原件不会修改。编码结束后展示对比，只有最终确认才写入。'});
    const progress=this.contentEl.createDiv();
    new Setting(this.contentEl).addButton(b=>b.setButtonText('取消').onClick(()=>this.close()));
    void this.batch.prepare(this.paths,this.config,item=>progress.createEl('p',{text:item.path+': '+(item.encoded?'已校验临时结果':item.reason)})).then(items=>{
      if(!this.isOpen())return;this.allowClose=true;this.close();new CompareModal(this.app,this.batch,items,this.config).open();
    }).catch(e=>{progress.createEl('p',{text:String(e)});});
  }
  private isOpen():boolean{return this.contentEl.isConnected;}
  override onClose():void {if(!this.allowClose)this.batch.cancel();this.contentEl.empty();}
}
class CompareModal extends Modal {
  private urls:string[]=[];private coordinator:PlaybackCoordinator;private selected=new Set<string>();
  constructor(app:App,private batch:BatchService,private items:Prepared[],private config:Config){super(app);this.coordinator=new PlaybackCoordinator(()=>({...config,'auto.mode':'off'}));}
  override onOpen():void {
    this.contentEl.addClass('live-media');this.titleEl.setText('3 · 对比并确认 / Review');
    this.contentEl.createEl('p',{text:`输出：${this.config['compression.output']==='copy'?'同扩展名副本，文章引用保持原件':'替换原件，先保存并校验备份'}。照片可直接点击播放；取消不写入。`});
    for(const item of this.items){
      const card=this.contentEl.createDiv({cls:'live-media-compare'});card.createEl('h3',{text:item.path});
      if(!item.encoded){card.createEl('p',{text:item.reason??'未编码'});continue;}
      this.selected.add(item.path);
      new Setting(card).setName(`${(item.input.length/1048576).toFixed(2)} → ${(item.encoded.bytes.length/1048576).toFixed(2)} MiB`)
        .setDesc(item.encoded.warnings.join(' ')).addToggle(t=>t.setValue(true).onChange(v=>{if(v)this.selected.add(item.path);else this.selected.delete(item.path);}));
      const grid=card.createDiv({cls:'live-media-compare-grid'});
      for(const [label,bytes,p] of [['原件',item.input,item.encoded.before],['结果',item.encoded.bytes,item.encoded.after]]as const){
        const cell=grid.createDiv();cell.createEl('p',{text:label});const image=cell.createEl('img',{attr:{alt:label}});
        const url=URL.createObjectURL(new Blob([bytes.slice().buffer]));this.urls.push(url);image.src=url;
        if(p.live&&p.videoStart!==undefined){const videoURL=URL.createObjectURL(new Blob([bytes.slice(p.videoStart).buffer],{type:'video/mp4'}));this.urls.push(videoURL);
          new Photo(image,videoURL,()=>({...this.config,'auto.mode':'off'}),this.coordinator,()=>true,()=>{},m=>new Notice(m),()=>{});}
      }
    }
    new Setting(this.contentEl).setName('最终确认 · Final confirmation').addButton(b=>b.setButtonText('保存已选结果').setCta().onClick(()=>{
      if(!this.selected.size){new Notice('No validated results selected');return;}
      const items=this.items.filter(i=>this.selected.has(i.path));this.close();new CommitModal(this.app,this.batch,items,this.config).open();
    }));
  }
  override onClose():void {this.coordinator.destroy();for(const u of this.urls)URL.revokeObjectURL(u);this.contentEl.empty();}
}
class CommitModal extends Modal {
  constructor(app:App,private batch:BatchService,private items:Prepared[],private config:Config){super(app);}
  override onOpen():void {
    this.contentEl.addClass('live-media');this.titleEl.setText('4 · 保存与读回 / Commit');
    const status=this.contentEl.createDiv();status.createEl('p',{text:'正在串行保存…'});
    new Setting(this.contentEl).addButton(b=>b.setButtonText('停止剩余队列').onClick(()=>this.batch.cancel()));
    void this.batch.commit(this.items,this.config).then(logs=>{status.empty();for(const j of logs)status.createEl('p',{text:j.target+' · '+j.state+(j.error?' · '+j.error:'')});}).catch(e=>status.createEl('p',{text:String(e)}));
  }
  override onClose():void {this.batch.cancel();this.contentEl.empty();}
}
export class RecoveryModal extends Modal {
  constructor(app:App,private batch:BatchService,private config:Config){super(app);}
  override onOpen():void {
    this.contentEl.addClass('live-media');this.titleEl.setText('恢复原件 / Recovery');
    this.contentEl.createEl('p',{text:'仅当当前文件仍与本插件写入指纹一致时恢复。不覆盖用户后续修改，不自动删除备份。'});
    void this.batch.recovery(this.config).then(logs=>{
      if(!logs.length)this.contentEl.createEl('p',{text:'没有可恢复的原件备份。'});
      for(const j of logs){const expired=this.config['storage.backupRetention']==='manual-days'&&Date.now()-j.timestamp>Number(this.config['storage.backupDays'])*86400000;
        new Setting(this.contentEl).setName(j.source).setDesc(j.state+(expired?' · 达到保留天数，仅供主动检查':''))
          .addButton(b=>b.setButtonText('恢复').onClick(()=>{void this.batch.restore(j,this.config).then(()=>new Notice('Original restored')).catch(e=>new Notice(String(e)));}));}
    }).catch(e=>this.contentEl.createEl('p',{text:String(e)}));
  }
  override onClose():void {this.contentEl.empty();}
}
