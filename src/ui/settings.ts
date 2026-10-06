// SPDX-License-Identifier: GPL-3.0-only
import {Modal, PluginSettingTab, Setting, Notice, type App, type Plugin} from 'obsidian';
import {schema, defaults, validatePatch, validateCombined, type SettingsModel, type Config, type Field, type Value} from '../settings/model';
const groups:Record<string,string>={render:'视图 · Views',badge:'LIVE 标识 · Badge',manual:'手动播放 · Manual playback',gesture:'手势 · Gestures',host:'查看器兼容 · Host',accessibility:'无障碍 · Accessibility',appearance:'外观 · Appearance',auto:'自动预览 · Automatic preview',detect:'检测 · Detection',scope:'扫描范围 · Scope',pairing:'照片配对 · Pairing',compatibility:'插件兼容 · Compatibility',network:'联网 · Network',compression:'压缩 · Compression',performance:'性能 · Performance',storage:'副本与恢复 · Storage',native:'本机后端 · Native',diagnostics:'诊断 · Diagnostics',settings:'偏好 · Preferences'};
export function dependency(field:Field,c:Config):string|undefined {
  const key=field.key;
  if(key==='compression.maxImageEdge'&&!c['compression.resizeImage'])return '先开启图片缩放';
  if(key==='compression.maxVideoEdge'&&!c['compression.resizeVideo'])return '先开启视频缩放';
  if(key==='storage.backupDays'&&c['storage.backupRetention']!=='manual-days')return '仅主动按天数检查时生效';
  if(key.startsWith('auto.hover')&&key!=='auto.hover'&&!c['auto.hover'])return '先开启悬停预览';
  if(key==='performance.marginPx'&&c['performance.preload']!=='near-visible')return '仅近可见预加载生效';
  if(key==='gesture.longPressMs'&&c['manual.gesture']!=='long-press')return '仅长按手势生效';
  if(key==='gesture.modifier'&&c['manual.gesture']!=='modified-click')return '仅组合键点击生效';
  if(key==='compression.targetVideoMbps')return 'WebCodecs 路线尚未通过时间与音轨保护门槛，不可用';
  if(key==='network.remote')return '候选版本只处理库内原件；不下载远端媒体';
  return undefined;
}
export class JsonModal extends Modal {
  constructor(app:App,private title:string,private value:string,private submit?:(text:string)=>Promise<void>){super(app);}
  override onOpen():void {
    this.contentEl.addClass('live-media');this.titleEl.setText(this.title);
    const text=this.contentEl.createEl('textarea',{cls:'live-media-json'});text.value=this.value;text.rows=16;text.spellcheck=false;
    if(this.submit)new Setting(this.contentEl).addButton(b=>b.setButtonText('确认 · Confirm').setCta().onClick(()=>{void this.submit!(text.value).then(()=>this.close()).catch(e=>new Notice(String(e)));}));
    else new Setting(this.contentEl).addButton(b=>b.setButtonText('复制 · Copy').onClick(()=>{void navigator.clipboard.writeText(text.value);}));
  }
  override onClose():void {this.contentEl.empty();}
}
export class LiveSettingsTab extends PluginSettingTab {
  private search='';private advanced=false;
  constructor(app:App,plugin:Plugin,private model:SettingsModel,private save:()=>Promise<void>,private changed:()=>void){super(app,plugin);}
  override display():void {
    const root=this.containerEl;root.empty();root.addClass('live-media');
    root.createEl('h2',{text:'Live Media'});
    root.createEl('p',{text:'自动预览始终静音；默认保存副本。灰色选项附有真实能力或依赖说明。'});
    new Setting(root).setName('搜索设置 · Search').addSearch(s=>s.setValue(this.search).onChange(v=>{this.search=v;this.fields(root.querySelector('.live-media-fields')!);}));
    new Setting(root).setName('高级设置 · Advanced').addToggle(t=>t.setValue(this.advanced).onChange(v=>{this.advanced=v;this.display();}));
    new Setting(root).setName('偏好管理 · Preferences')
      .addButton(b=>b.setButtonText('导出').onClick(()=>new JsonModal(this.app,'脱敏偏好 · Export',this.model.exportPublic()).open()))
      .addButton(b=>b.setButtonText('导入').onClick(()=>new JsonModal(this.app,'预览并导入 · Import','{}',async text=>{
        const imported=JSON.parse(text) as {global?:unknown};const patch=validatePatch(imported.global??imported);delete patch['native.enabled'];delete patch['native.executable'];
        validateCombined({...this.model.effective(),...patch});
        const diff=Object.fromEntries(Object.entries(patch).filter(([k,v])=>JSON.stringify(v)!==JSON.stringify(this.model.effective()[k])));
        new JsonModal(this.app,'确认差异 · Confirm changes',JSON.stringify(diff,null,2),async()=>{this.model.data.global={...this.model.data.global,...diff};await this.persist();}).open();
      }).open()))
      .addButton(b=>b.setButtonText('有效配置').onClick(()=>new JsonModal(this.app,'本机有效配置 · Effective settings',JSON.stringify(this.model.effective(),null,2)).open()));
    new Setting(root).setName('预设 · Presets').addDropdown(d=>{
      d.addOption('','选择预设');for(const k of ['balanced','high','lossless',...Object.keys(this.model.data.presets)])d.addOption(k,k);
      d.onChange(v=>{if(!v)return;const custom=this.model.data.presets[v];
        if(custom)this.model.data.global={...this.model.data.global,...custom};
        else{this.model.set('compression.preset',v);this.model.set('compression.jpegQuality',v==='high'?95:85);this.model.set('compression.webpQuality',v==='high'?95:85);this.model.set('compression.ffmpegCrf',v==='high'?18:23);this.model.set('compression.allowLossy',v!=='lossless');}
        void this.persist();});
    }).addButton(b=>b.setButtonText('保存为预设').onClick(()=>new JsonModal(this.app,'预设名称','my-preset',async name=>{
      if(!/^[\w-]{1,64}$/.test(name))throw new Error('Use 1–64 letters/numbers/dashes');this.model.data.presets[name]={...this.model.data.global};await this.persist();
    }).open()));
    new Setting(root).setName('重置 · Reset').addButton(b=>b.setButtonText('全部默认').onClick(()=>new JsonModal(this.app,'确认恢复默认值','仅清除偏好，不删除照片、备份或报告。',async()=>{this.model.data.global={};this.model.data.platforms={};await this.persist();}).open()))
      .addButton(b=>b.setButtonText('清除预览记录').onClick(()=>{this.model.data.previewed=[];void this.persist();}));
    if(this.advanced){
      new Setting(root).setName('平台覆盖 · Platform profiles').addButton(b=>b.setButtonText('编辑 JSON').onClick(()=>new JsonModal(this.app,'平台覆盖',JSON.stringify(this.model.data.platforms,null,2),async text=>{
        const values=JSON.parse(text) as Record<string,unknown>;const next:typeof this.model.data.platforms={};
        for(const p of ['desktop','android','ios'] as const)if(values[p]){next[p]=validatePatch(values[p]);validateCombined({...defaults(p),...this.model.data.global,...next[p]});}
        this.model.data.platforms=next;await this.persist();}).open()));
      new Setting(root).setName('照片覆盖 · Photo overrides').addButton(b=>b.setButtonText('编辑 JSON').onClick(()=>new JsonModal(this.app,'单照片偏好',JSON.stringify(this.model.data.photos,null,2),async text=>{
        const values=JSON.parse(text) as Record<string,unknown>;const next:Record<string,Config>={};
        for(const [path,patch]of Object.entries(values)){if(!this.app.vault.getAbstractFileByPath(path))throw new Error('Photo path does not exist: '+path);next[path]=validatePatch(patch);}
        this.model.data.photos=next;await this.persist();}).open()));
    }
    const fields=root.createDiv({cls:'live-media-fields'});this.fields(fields);
  }
  private fields(root:Element):void {
    root.replaceChildren();const el=root as HTMLElement;let group='';const c=this.model.effective();
    const basic=new Set(['render','badge','manual','auto','compression']);
    for(const field of schema){
      if(!this.advanced&&!basic.has(field.group)&&!this.search)continue;
      if(this.search&&!`${field.key} ${field.description} ${field.spec}`.toLowerCase().includes(this.search.toLowerCase()))continue;
      if(group!==field.group){group=field.group;el.createEl('h3',{text:groups[group]??group});
        new Setting(el).setName('恢复该组默认值').addButton(b=>b.setButtonText('重置组').onClick(()=>{for(const f of schema.filter(f=>f.group===field.group))delete this.model.data.global[f.key];void this.persist();}));}
      const blocked=dependency(field,c);const row=new Setting(el).setName(field.key).setDesc(`${field.description} · ${field.spec} · 默认 ${JSON.stringify(field.default)}${blocked?' · '+blocked:''}`);
      const set=(v:unknown)=>{try{this.model.set(field.key,v);void this.save().then(()=>this.changed());}catch(e){new Notice(String(e));}};
      const val=c[field.key];
      if(field.kind==='boolean')row.addToggle(t=>t.setValue(!!val).setDisabled(!!blocked).onChange(set));
      else if(field.kind==='enum')row.addDropdown(d=>{for(const option of field.options??[])d.addOption(option,option);d.setValue(String(val)).setDisabled(!!blocked).onChange(set);});
      else if(field.kind==='json')row.addButton(b=>b.setButtonText('编辑').setDisabled(!!blocked).onClick(()=>new JsonModal(this.app,field.key,JSON.stringify(val,null,2),async text=>{this.model.set(field.key,JSON.parse(text));await this.persist();}).open()));
      else row.addText(t=>t.setValue(String(val)).setDisabled(!!blocked).onChange(v=>set(field.kind==='number'?Number(v):field.kind==='mixed'&&!field.options?.includes(v)?Number(v):v)));
      row.addExtraButton(b=>b.setIcon('rotate-ccw').setTooltip('恢复默认').onClick(()=>{delete this.model.data.global[field.key];void this.persist();}));
    }
  }
  private async persist():Promise<void>{await this.save();this.changed();this.display();}
}
