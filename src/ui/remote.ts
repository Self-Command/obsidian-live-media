import {Modal,Setting,Notice,requestUrl,type App} from 'obsidian';
import type {Config} from '../settings/model';
import {safePath} from '../settings/model';
import {probe} from '../media/probe';
import {Photo,PlaybackCoordinator} from '../playback/photo';
import {JsonModal} from './settings';
export class RemoteMediaModal extends Modal {
  private urls:string[]=[];private coordinator:PlaybackCoordinator;
  constructor(app:App,private url:URL,private config:Config){super(app);this.coordinator=new PlaybackCoordinator(()=>({...config,'auto.mode':'off'}));}
  override onOpen():void{
    this.contentEl.addClass('live-media');this.titleEl.setText('手动读取远程媒体 / Manual remote inspection');
    this.contentEl.createEl('p',{text:'读取仅在此次明确操作进行；不自动联网，不执行远端代码，不记录 URL 查询参数。'});
    const status=this.contentEl.createEl('p',{text:'正在读取…'});
    void requestUrl({url:this.url.href,method:'GET',throw:false}).then(response=>{
      if(!this.contentEl.isConnected)return;
      if(response.status<200||response.status>=300)throw new Error('Remote HTTP '+response.status);
      const bytes=new Uint8Array(response.arrayBuffer);
      if(bytes.length>Number(this.config['performance.maxInputMiB'])*1048576)throw new Error('Remote media exceeds input limit');
      const p=probe(bytes);if(!['jpeg','png','webp','gif','isobmff'].includes(p.format))throw new Error('Not a recognized photo container');
      status.setText(p.format+' · '+(p.live?'Live photo':'Static/protected photo')+' · '+p.protected.join('; '));
      const img=this.contentEl.createEl('img',{cls:'live-media-remote-image'});
      const photoURL=URL.createObjectURL(new Blob([bytes.slice().buffer]));this.urls.push(photoURL);img.src=photoURL;
      if(p.live&&p.videoStart!==undefined){const videoURL=URL.createObjectURL(new Blob([bytes.slice(p.videoStart).buffer],{type:'video/mp4'}));this.urls.push(videoURL);
        new Photo(img,videoURL,()=>({...this.config,'auto.mode':'off'}),this.coordinator,()=>true,()=>{},m=>new Notice(m),()=>{});}
      new Setting(this.contentEl).setName('保存库内副本 · Optional local copy').addButton(b=>b.setButtonText('选择新路径').onClick(()=>{
        const ext=p.format==='jpeg'?'jpg':p.format==='isobmff'?'avif':p.format;
        new JsonModal(this.app,'保存原始远程字节 / Save original bytes','remote-photo.'+ext,async path=>{
          safePath(path);if(this.app.vault.getAbstractFileByPath(path))throw new Error('Existing path');
          if(!path.toLowerCase().endsWith('.'+ext))throw new Error('Keep the detected extension');
          await this.app.vault.createBinary(path,bytes.slice().buffer);new Notice('Saved local copy; run media scan to compress it.');
        }).open();
      }));
    }).catch(error=>{if(this.contentEl.isConnected)status.setText(String(error));});
  }
  override onClose():void{this.coordinator.destroy();for(const url of this.urls)URL.revokeObjectURL(url);this.contentEl.empty();}
}
