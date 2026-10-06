// SPDX-License-Identifier: GPL-3.0-only
import {MarkdownRenderChild,TFile,type App} from 'obsidian';
import type {SettingsModel} from '../settings/model';
import type {ReferenceIndex} from '../references/vault';
import {probe} from '../media/probe';
import {ByteCache} from './cache';
import {Photo,PlaybackCoordinator} from './photo';
import {trustedApplePair} from '../media/apple';
export class HostManager {
  cache:ByteCache;coordinator:PlaybackCoordinator;private sessions=new Set<HostSession>();private previewed=new Set<string>();
  constructor(public app:App,public model:SettingsModel,public index:ReferenceIndex,public notice:(m:string)=>void,public save:()=>void){
    const c=model.effective();this.cache=new ByteCache(Number(c['performance.cacheMiB'])*1048576,Number(c['performance.cacheEntries']));
    this.coordinator=new PlaybackCoordinator(()=>model.effective());this.previewed=new Set(model.data.previewed);
  }
  attach(root:HTMLElement,source:string,kind:'reading'|'preview'):HostSession {
    const session=new HostSession(this,root,source,kind);this.sessions.add(session);session.start();return session;
  }
  forget(session:HostSession):void {this.sessions.delete(session);}
  settingsChanged():void {
    const c=this.model.effective();this.cache.maxBytes=Number(c['performance.cacheMiB'])*1048576;this.cache.maxEntries=Number(c['performance.cacheEntries']);this.cache.prune();
    for(const s of this.sessions)s.refresh();
  }
  invalidate(path:string):void {this.cache.invalidate(path);for(const s of this.sessions)s.invalidate(path);}
  wasPreviewed(path:string):boolean{return this.previewed.has(path);}
  remember(path:string):void {this.previewed.add(path);if(this.model.effective()['auto.remember']==='persistent'){this.model.data.previewed=[...this.previewed].slice(-10000);this.save();}}
  destroy():void {for(const s of [...this.sessions])s.destroy();this.coordinator.destroy();this.cache.clear();}
}
export class HostSession extends MarkdownRenderChild {
  private observer?:MutationObserver;private visibility?:IntersectionObserver;
  private photos=new Map<HTMLImageElement,{photo:Photo;path:string}>();private waiting=new Set<HTMLImageElement>();private generation=0;private closed=false;
  private inflight=0;private queue:Array<()=>Promise<void>>=[];
  private negatives=new WeakMap<HTMLImageElement,string>();
  private retireTimers=new Map<HTMLImageElement,ReturnType<typeof setTimeout>>();
  constructor(private manager:HostManager,private root:HTMLElement,private source:string,private kind:'reading'|'preview'){super(root);}
  start():void {
    this.load();this.scan();
    this.visibility=new IntersectionObserver(entries=>{for(const entry of entries){
      const img=entry.target as HTMLImageElement;const timer=this.retireTimers.get(img);
      if(entry.isIntersecting){if(timer)clearTimeout(timer);this.retireTimers.delete(img);continue;}
      if(timer||!this.photos.has(img))continue;
      this.retireTimers.set(img,setTimeout(()=>{
        this.retireTimers.delete(img);const record=this.photos.get(img);if(!record||this.closed)return;
        record.photo.destroy();this.photos.delete(img);this.visibility?.unobserve(img);this.scan();
      },Number(this.manager.model.effective()['performance.warmSeconds'])*1000));
    }});
    this.observer=new MutationObserver(()=>{queueMicrotask(()=>{if(!this.closed)this.scan();});});
    this.observer.observe(this.root,{subtree:true,childList:true,attributes:true,attributeFilter:['src','srcset']});
  }
  private enqueue(fn:()=>Promise<void>):void {this.queue.push(fn);this.pump();}
  private pump():void {const c=this.manager.model.effective();while(this.inflight<Number(c['performance.probeConcurrent'])&&this.queue.length){const fn=this.queue.shift()!;this.inflight++;void fn().finally(()=>{this.inflight--;this.pump();});}}
  private scan():void {
    const c=this.manager.model.effective();
    if((this.kind==='reading'&&!c['render.reading'])||(this.kind==='preview'&&!c['render.livePreview']))return;
    for(const [img,value]of this.photos)if(!img.isConnected||!this.root.contains(img)||this.manager.index.rendered(img,this.source).path!==value.path){value.photo.destroy();this.photos.delete(img);}
    const note=this.manager.app.vault.getAbstractFileByPath(this.source);
    const noteOverrides=note instanceof TFile?this.manager.app.metadataCache.getFileCache(note)?.frontmatter?.live_media:undefined;
    for(const img of this.root.querySelectorAll<HTMLImageElement>('img')){
      if(img.closest('.live-media-photo-layer')||this.photos.has(img)||this.waiting.has(img))continue;
      const gallery=img.matches('.simple-gallery-img')||!!img.closest('.simple-gallery-container, .simple-gallery-grid, .simple-gallery');
      const overrides=c['compatibility.hostOverrides']as Record<string,unknown>;
      if(gallery&&(!c['render.gallery']||overrides['simple-gallery']==='disabled'))continue;
      const ref=this.manager.index.rendered(img,this.source);if(!ref.path)continue;
      const file=this.manager.app.vault.getAbstractFileByPath(ref.path);if(!(file instanceof TFile)||!this.manager.index.eligible(file))continue;
      const identity=file.path+'\0'+file.stat.mtime+'\0'+file.stat.size;
      if(this.negatives.get(img)===identity)continue;
      this.waiting.add(img);const generation=this.generation;
      const load=()=>this.enqueue(async()=>{
        let release:(()=>void)|undefined;let url:string|undefined;
        try{
          const settings=this.manager.model.effective(file.path,noteOverrides);
          if(file.stat.size>Number(settings['performance.maxInputMiB'])*1048576)return;
          const key=file.path+'\0'+file.stat.mtime+'\0'+file.stat.size;
          let bytes=this.manager.cache.get(key);
          if(!bytes){bytes=new Uint8Array(await this.manager.app.vault.readBinary(file));if(this.closed||generation!==this.generation)return;this.manager.cache.put(key,bytes);}
          const p=probe(bytes);let video:Uint8Array|undefined;
          if(p.live&&p.videoStart!==undefined)video=bytes.slice(p.videoStart);
          else {
            const pairs=settings['pairing.explicit']as Array<{photo:string;video:string}>;const pair=pairs.find(pair=>pair.photo===file.path);
            if(pair){const target=this.manager.app.vault.getAbstractFileByPath(pair.video);if(target instanceof TFile&&target.stat.size<Number(settings['performance.maxInputMiB'])*1048576)video=new Uint8Array(await this.manager.app.vault.readBinary(target));}
            if(!video&&settings['pairing.sameNameCandidates']&&['jpg','jpeg'].includes(file.extension.toLowerCase())){
              const stem=file.path.slice(0,-file.extension.length);
              for(const extension of ['mov','MOV','mp4','MP4']){
                const target=this.manager.app.vault.getAbstractFileByPath(stem+extension);
                if(target instanceof TFile&&target.stat.size<Number(settings['performance.maxInputMiB'])*1048576){
                  const movie=new Uint8Array(await this.manager.app.vault.readBinary(target));
                  if(trustedApplePair(bytes,movie)){video=movie;break;}
                }
              }
            }
          }
          if(!video){this.negatives.set(img,identity);return;}
          if(this.closed||generation!==this.generation||!img.isConnected||this.manager.index.rendered(img,this.source).path!==file.path)return;
          release=this.manager.cache.retain(key,Number(settings['performance.warmSeconds']));url=URL.createObjectURL(new Blob([video.slice().buffer],{type:'video/mp4'}));
          const finalURL=url,finalRelease=release;
          const photo=new Photo(img,url,()=>{
            const effective=this.manager.model.effective(file.path,noteOverrides);
            if(gallery&&overrides['simple-gallery']==='viewer')effective['host.clickPriority']='viewer';
            return effective;
          },this.manager.coordinator,()=>this.manager.wasPreviewed(file.path),()=>this.manager.remember(file.path),this.manager.notice,
          ()=>{URL.revokeObjectURL(finalURL);finalRelease();},this.kind);
          this.photos.set(img,{photo,path:file.path});this.visibility?.observe(img);url=undefined;release=undefined;
        }catch{/* corrupt/unsupported image remains ordinary host image */}
        finally{if(url)URL.revokeObjectURL(url);release?.();this.waiting.delete(img);}
      });
      const preload=c['performance.preload'];
      if(preload==='manual'){
        // Pointer/focus preloads before the user's click. Loading itself never starts sound.
        const trigger=()=>{img.removeEventListener('pointerenter',trigger);img.removeEventListener('focus',trigger);load();};
        img.addEventListener('pointerenter',trigger,{once:true});img.addEventListener('focus',trigger,{once:true});
        this.register(()=>{img.removeEventListener('pointerenter',trigger);img.removeEventListener('focus',trigger);});
      }else{
        const margin=preload==='near-visible'?Number(c['performance.marginPx']):0;
        const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer.disconnect();load();}},{rootMargin:margin+'px'});
        observer.observe(img);this.register(()=>observer.disconnect());
      }
    }
  }
  refresh():void {const c=this.manager.model.effective();this.negatives=new WeakMap();
    if((this.kind==='reading'&&!c['render.reading'])||(this.kind==='preview'&&!c['render.livePreview'])){
      this.generation++;for(const {photo}of this.photos.values())photo.destroy();this.photos.clear();this.waiting.clear();return;
    }
    for(const {photo}of this.photos.values())photo.refresh();this.scan();}
  invalidate(path:string):void {this.generation++;this.negatives=new WeakMap();for(const [img,value]of this.photos)if(value.path===path){value.photo.destroy();this.photos.delete(img);}this.waiting.clear();this.scan();}
  destroy():void {this.unload();}
  override onunload():void {if(this.closed)return;this.closed=true;this.generation++;this.observer?.disconnect();this.visibility?.disconnect();this.queue=[];
    for(const t of this.retireTimers.values())clearTimeout(t);this.retireTimers.clear();
    for(const value of this.photos.values())value.photo.destroy();this.photos.clear();this.waiting.clear();this.manager.forget(this);}
}
