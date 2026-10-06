// SPDX-License-Identifier: GPL-3.0-only
import {Modal,Setting,Notice,TFile,FuzzySuggestModal,type App} from 'obsidian';
import type {ReferenceIndex} from '../references/vault';
import type {Reference} from '../references/source';
import type {BatchService,Prepared,Journal} from '../compression/batch';
import type {Config} from '../settings/model';
import {Photo,PlaybackCoordinator} from '../playback/photo';
import {JsonModal} from './settings';
export class ScanModal extends Modal {
  private abort=new AbortController();private selected=new Set<string>();private refs:Reference[]=[];
  private range:string;private outputMode:'copy'|'replace';private shared=new Map<string,string[]>();private next=false;
  private revision=0;
  constructor(app:App,private index:ReferenceIndex,private batch:BatchService,private settings:(path?:string,note?:unknown)=>Config,private initial?:TFile[]){super(app);this.range=initial?.length?'selected-files':String(settings()['compression.defaultScope']);this.outputMode=settings()['compression.output']==='replace'?'replace':'copy';}
  override onOpen():void {this.contentEl.addClass('live-media');this.render();}
  private render():void {
    this.contentEl.empty();this.titleEl.setText('1 · 选择范围 / Select media');
    this.contentEl.createEl('p',{text:'扫描只读取文件。直接引用默认选中；动态展示和未知语法候选需要确认。共享原件会列出引用文章。'});
    new Setting(this.contentEl).setName('范围 · Scope').addDropdown(d=>d.addOptions({'current-note':'当前文章','selected-files':'选定文件','vault':'全库图片'}).setValue(this.range).onChange(v=>{this.range=v;this.render();}));
    new Setting(this.contentEl).setName('保存方式').setDesc('生成副本不会改变文章中的图片；替换原图保留路径和引用，先备份。下一步仅准备临时结果，最后确认才保存。')
      .addDropdown(d=>d.addOptions({copy:'生成压缩副本，保留原图',replace:'备份后替换原图，文章使用压缩图'}).setValue(this.outputMode).onChange(v=>{this.outputMode=v==='replace'?'replace':'copy';}));
    if(this.range==='selected-files')new Setting(this.contentEl).setName('选定文件').addButton(b=>b.setButtonText('搜索并添加图片').onClick(()=>{
      new MediaPicker(this.app,this.index,file=>{this.initial??=[];if(!this.initial.some(f=>f.path===file.path))this.initial.push(file);void this.scan();}).open();
    }));
    const list=this.contentEl.createDiv({cls:'live-media-scan-list'});
    new Setting(this.contentEl).addButton(b=>b.setButtonText('下一步：准备临时结果').setCta().onClick(()=>{
      if(!this.selected.size){new Notice('Select at least one verified file');return;}
      this.next=true;const c={...this.settings(),'compression.output':this.outputMode};const paths=[...this.selected];
      const note=this.range==='current-note'?this.app.workspace.getActiveFile():null;
      const overrides=note?this.app.metadataCache.getFileCache(note)?.frontmatter?.live_media:undefined;
      const perFile=new Map(paths.map(path=>[path,structuredClone({...this.settings(path,overrides),'compression.output':this.outputMode})]));
      this.close();new PrepareModal(this.app,this.batch,paths,c,perFile).open();
    }));
    void this.scan(list);
  }
  private async scan(list=this.contentEl.querySelector<HTMLElement>('.live-media-scan-list')!):Promise<void>{
    const revision=++this.revision;const current=()=>!this.abort.signal.aborted&&revision===this.revision&&list.isConnected;
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
        if(c['scope.embeddedNotes']){
          const visited=new Set([file.path]);const queue=[...this.refs];
          while(queue.length){if(!current())return;const ref=queue.shift()!;if(ref.evidence!=='direct')continue;
            const target=ref.path?this.app.vault.getAbstractFileByPath(ref.path):null;
            if(target instanceof TFile&&target.extension==='md'&&!visited.has(target.path)){
              if(visited.size>=1000)throw new Error('Embedded-note traversal limit reached; choose a smaller scope');visited.add(target.path);
              const refs=await this.index.note(target,this.abort.signal);this.refs.push(...refs);queue.push(...refs);
            }
          }
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
        if(!current())return;
        for(const ref of await this.index.note(note,this.abort.signal))if(ref.path&&unique.has(ref.path)&&ref.evidence==='direct'){
          const sources=this.shared.get(ref.path)??[];if(!sources.includes(note.path))sources.push(note.path);this.shared.set(ref.path,sources);
        }
      }
      if(!current())return;list.empty();
      const unresolved=this.refs.filter(ref=>!ref.path).length;if(unresolved)list.createEl('p',{text:`${unresolved} 条引用未能关联真实文件，已保护跳过；不会按文件名猜测。`});
      if(!refs.length){list.createEl('p',{text:'没有可处理的库内图片。选定文件范围使用文件菜单；未知 URL 不猜测原件。'});return;}
      for(const ref of refs){const path=ref.path!,shared=this.shared.get(path)??[];const skip=shared.length>1&&c['compression.includeShared']==='skip';
        const chosen=!skip&&shared.length<=1&&(ref.evidence==='direct'||(ref.evidence==='dynamic'&&!!c['scope.dynamicSelected']));if(chosen)this.selected.add(path);
        const row=new Setting(list).setName(path).setDesc(`${ref.evidence} · ${ref.origin}${shared.length>1?' · 共享于 '+shared.join(', '):''}${skip?' · 已按设置跳过':''}`);
        row.addToggle(t=>t.setValue(chosen).setDisabled(skip).onChange(v=>{if(v)this.selected.add(path);else this.selected.delete(path);}));
      }
    }catch(e){if(current()){list.empty();list.createEl('p',{text:String(e)});}}
  }
  override onClose():void {this.abort.abort();this.contentEl.empty();}
}
class MediaPicker extends FuzzySuggestModal<TFile>{
  constructor(app:App,private index:ReferenceIndex,private choose:(file:TFile)=>void){super(app);this.setPlaceholder('输入图片文件名或路径 / Search image path');}
  override getItems():TFile[]{return this.app.vault.getFiles().filter(file=>this.index.eligible(file));}
  override getItemText(file:TFile):string{return file.path;}
  override onChooseItem(file:TFile):void{this.choose(file);}
}
class PrepareModal extends Modal {
  private leaveForReview=false;private disposed=false;private prepared?:Prepared[];
  private action?:HTMLButtonElement;private progress!:HTMLElement;
  constructor(app:App,private batch:BatchService,private paths:string[],private config:Config,private perFile:Map<string,Config>){super(app);}
  override onOpen():void {
    this.disposed=false;this.contentEl.addClass('live-media');this.titleEl.setText('2 · 逐张压缩 / Compress one by one');
    this.contentEl.createEl('p',{text:'每张依次读取、检查、压缩并校验，完成一张再处理下一张；单张失败继续。原件只读，确认后才保存结果。'});
    const summary=this.contentEl.createEl('p',{cls:'live-media-progress-summary',text:`已完成 0 / ${this.paths.length}`});
    const current=this.contentEl.createEl('p',{cls:'live-media-progress-current',attr:{role:'status','aria-live':'polite'}});
    const meter=this.contentEl.createEl('progress',{cls:'live-media-progress',attr:{max:String(this.paths.length),value:'0','aria-label':'逐张压缩进度'}});
    this.progress=this.contentEl.createDiv({cls:'live-media-progress-results'});
    new Setting(this.contentEl).addButton(b=>{this.action=b.buttonEl;b.setButtonText('取消').onClick(()=>{if(this.prepared)this.review();else this.close();});});
    let success=0,skipped=0,failed=0;const finished=new Set<string>();
    void this.batch.prepare(this.paths,this.config,item=>{
      if(this.disposed)return;finished.add(item.path);
      if(item.encoded)success++;else if(item.outcome==='protected')skipped++;else failed++;
      const completed=this.paths.filter(path=>finished.has(path)).length;meter.value=completed;
      summary.setText(`已完成 ${completed} / ${this.paths.length} · 临时结果 ${success}（未保存） · 跳过 ${skipped} · 失败 ${failed}`);
      const row=this.progress.createEl('p',{cls:'live-media-progress-result',text:item.path+': '+(item.encoded?'临时结果已校验，尚未保存':item.outcome==='protected'?'已保护跳过 · '+item.reason:'本张失败，继续下一张 · '+item.reason)});
      row.dataset.outcome=item.encoded?'success':item.outcome==='protected'?'protected':'failed';
    },path=>this.perFile.get(path)??this.config,(path,stage)=>{
      if(this.disposed)return;current.setText(`当前 ${this.paths.indexOf(path)+1} / ${this.paths.length} · ${stage==='reading'?'读取':stage==='checking'?'检查':'压缩与校验'} · ${path}`);
    }).then(items=>{
      if(this.disposed)return;this.prepared=items;current.setText('临时结果准备完成，尚未保存；正在打开对比确认…');this.review();
    }).catch(error=>{if(!this.disposed){current.setText('批次停止');this.progress.createEl('p',{text:String(error)});}});
  }
  private review():void {
    if(this.disposed||!this.prepared)return;
    const review=new CompareModal(this.app,this.batch,this.prepared,this.config);
    try{review.open();this.leaveForReview=true;this.close();}
    catch(error){review.close();this.progress.createEl('p',{text:'对比面板未能打开；压缩结果仍保留，点击重试，无需重新压缩。 '+String(error)});if(this.action)this.action.textContent='重试打开结果';}
  }
  override onClose():void {this.disposed=true;if(!this.leaveForReview)this.batch.cancel();this.contentEl.empty();}
}
class CompareModal extends Modal {
  private coordinator:PlaybackCoordinator;private selected=new Set<string>();
  private observer?:IntersectionObserver;private closed=false;
  private previews=new Map<HTMLElement,{item:Prepared;generation:number;active:boolean;urls:string[];photos:Photo[]}>();
  constructor(app:App,private batch:BatchService,private items:Prepared[],private config:Config){super(app);this.coordinator=new PlaybackCoordinator(()=>({...config,'auto.mode':'off'}));}
  override onOpen():void {
    this.contentEl.addClass('live-media');this.titleEl.setText('3 · 对比并确认 / Review');
    this.observer=new IntersectionObserver(entries=>{for(const entry of entries){const grid=entry.target as HTMLElement;if(entry.isIntersecting)void this.mount(grid);else this.release(grid);}},{rootMargin:'160px'});
    const pending=this.items.filter(item=>item.encoded).length;
    this.contentEl.createEl('p',{cls:'live-media-pending',text:`${pending} 张临时结果已校验，但尚未保存。关闭面板会丢弃临时结果，原图不会变化。`});
    const actions=this.contentEl.createDiv({cls:'live-media-review-actions'});
    const outputExplanation=actions.createEl('p',{cls:'live-media-output-explanation'});let saveButton:HTMLButtonElement|undefined;
    const explain=()=>{const replace=this.config['compression.output']==='replace';
      outputExplanation.setText(replace?'确认后先备份，再将压缩结果写回原路径，名称与文章引用不变。':'确认后生成压缩副本；原图与文章引用不变。要让文章使用压缩图，请选择备份后替换原图。');
      if(saveButton)saveButton.textContent=replace?'确认替换原图（先备份）':'确认保存压缩副本';};
    new Setting(actions).setName('保存方式').addDropdown(d=>d.addOptions({copy:'生成压缩副本，保留原图',replace:'备份后替换原图，文章使用压缩图'}).setValue(String(this.config['compression.output'])).onChange(v=>{this.config['compression.output']=v==='replace'?'replace':'copy';explain();}));
    new Setting(actions).setName('最终确认后才写入').addButton(b=>{saveButton=b.buttonEl;b.setCta().onClick(()=>{
      if(!this.selected.size){new Notice('没有已校验并选中的结果');return;}
      const items=this.items.filter(i=>this.selected.has(i.path)),commit=new CommitModal(this.app,this.batch,items,{...this.config});
      try{commit.open();this.close();}catch(error){commit.close();new Notice('保存面板未能打开，临时结果仍保留。 '+String(error));}
    });});explain();
    for(const item of this.items){
      const card=this.contentEl.createDiv({cls:'live-media-compare'});card.createEl('h3',{text:item.path});
      if(!item.encoded){card.createEl('p',{text:item.reason??'未编码'});continue;}
      this.selected.add(item.path);
      new Setting(card).setName(`${((item.inputBytes??item.input.length)/1048576).toFixed(2)} → ${(item.encoded.bytes.length/1048576).toFixed(2)} MiB`)
        .setDesc(item.encoded.warnings.join(' ')).addToggle(t=>t.setValue(true).setDisabled(!!item.group).onChange(v=>{if(v)this.selected.add(item.path);else this.selected.delete(item.path);}));
      if(item.encoded.before.format==='mov'){card.createEl('p',{text:'与照片作为同一媒体组处理；不显示视频播放器。'});continue;}
      const grid=card.createDiv({cls:'live-media-compare-grid'});grid.style.minHeight='180px';
      grid.createEl('p',{text:'滚动到此处加载原件与结果 / Load comparison when visible'});
      this.previews.set(grid,{item,generation:0,active:false,urls:[],photos:[]});this.observer.observe(grid);
    }
  }
  private async mount(grid:HTMLElement):Promise<void>{
    const state=this.previews.get(grid);if(!state||state.active||this.closed)return;
    state.active=true;const generation=++state.generation,item=state.item;
    try{
      const original=await this.batch.original(item);
      if(this.closed||generation!==state.generation||!state.active)return;grid.empty();
      for(const [label,bytes,p] of [['原件',original,item.encoded!.before],['结果',item.encoded!.bytes,item.encoded!.after]]as const){
        const cell=grid.createDiv();cell.createEl('p',{text:label});const image=cell.createEl('img',{attr:{alt:label}});
        const url=URL.createObjectURL(new Blob([bytes.slice().buffer]));state.urls.push(url);image.src=url;
        if(p.live&&p.videoStart!==undefined){const videoURL=URL.createObjectURL(new Blob([bytes.slice(p.videoStart).buffer],{type:'video/mp4'}));state.urls.push(videoURL);
          state.photos.push(new Photo(image,videoURL,()=>({...this.config,'auto.mode':'off'}),this.coordinator,()=>true,()=>{},m=>new Notice(m),()=>{}));}
      }
    }catch(error){if(!this.closed&&generation===state.generation){grid.empty();grid.createEl('p',{text:String(error)});}}
  }
  private release(grid:HTMLElement):void{
    const state=this.previews.get(grid);if(!state)return;state.generation++;state.active=false;
    for(const photo of state.photos)photo.destroy();state.photos=[];
    for(const url of state.urls)URL.revokeObjectURL(url);state.urls=[];
    grid.empty();grid.createEl('p',{text:'滚动到此处加载原件与结果 / Load comparison when visible'});
  }
  override onClose():void {this.closed=true;this.observer?.disconnect();for(const grid of this.previews.keys())this.release(grid);this.previews.clear();this.coordinator.destroy();this.contentEl.empty();}
}
class CommitModal extends Modal {
  private disposed=false;
  constructor(app:App,private batch:BatchService,private items:Prepared[],private config:Config){super(app);}
  override onOpen():void {
    this.disposed=false;this.contentEl.addClass('live-media');this.titleEl.setText('4 · 保存与读回 / Commit');
    const summary=this.contentEl.createEl('p',{cls:'live-media-save-summary',text:'正在保存并读回校验，尚未完成…'});
    const mode=this.config['compression.output']==='replace'?'原图替换':'压缩副本';
    this.contentEl.createEl('p',{text:mode==='原图替换'?'压缩文件将保留原路径、名称及文章引用；原件备份通过后才写入。':'本次生成压缩副本，文章仍引用原图。'});
    const status=this.contentEl.createDiv({cls:'live-media-save-results'});
    new Setting(this.contentEl).addButton(b=>b.setButtonText('停止剩余队列').onClick(()=>this.batch.cancel()));
    const show=(logs:Journal[],finished:boolean)=>{
      if(this.disposed)return;
      const saved=logs.filter(j=>j.state==='committed');let original=0,compressed=0;
      for(const log of saved){const item=this.items.find(i=>i.path===log.source);if(item?.encoded){original+=item.inputBytes??item.input.length;compressed+=item.encoded.bytes.length;}}
      summary.setText(`${finished?'保存结束':'正在保存'} · 已保存并读回校验 ${saved.length} / ${this.items.length} · 失败 ${logs.filter(j=>j.state!=='committed').length} · 未处理 ${this.items.length-logs.length}`+(saved.length?` · ${(original/1048576).toFixed(2)} → ${(compressed/1048576).toFixed(2)} MiB`:''));
      status.empty();for(const j of logs)status.createEl('p',{text:j.target+' · '+(j.state==='committed'?(mode==='原图替换'?'原图已替换并读回校验通过':'压缩副本已保存并读回校验通过'):'未成功保存 · '+j.state)+(j.error?' · '+j.error:'')});
    };
    const logs:Journal[]=[];
    void this.batch.commit(this.items,this.config,journal=>{logs.push(journal);show(logs,false);}).then(result=>show(result,true)).catch(error=>{if(!this.disposed){summary.setText('保存未完成，不能视为压缩已保存');status.createEl('p',{text:String(error)});}});
  }
  override onClose():void {this.disposed=true;this.batch.cancel();this.contentEl.empty();}
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
          .addButton(b=>b.setButtonText('恢复').onClick(()=>{void this.batch.restore(j,this.config).then(()=>new Notice('Original restored')).catch(e=>new Notice(String(e)));}))
          .addButton(b=>b.setButtonText('导出原件副本').onClick(()=>new JsonModal(this.app,'保存备份副本；不覆盖现有文件',j.source.replace(/(\.[^.]+)$/,'-recovered$1'),async path=>{await this.batch.recoverCopy(j,path);new Notice('Verified original copy saved');}).open()));}
    }).catch(e=>this.contentEl.createEl('p',{text:String(e)}));
  }
  override onClose():void {this.contentEl.empty();}
}
