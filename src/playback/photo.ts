// SPDX-License-Identifier: GPL-3.0-only
import type {Config} from '../settings/model';
export class PlaybackCoordinator {
  photos=new Set<Photo>();
  constructor(private settings:()=>Config){}
  admit(photo:Photo,manual:boolean):boolean {
    const playing=[...this.photos].filter(p=>p.playing&&p!==photo);
    if(manual){for(const p of playing)p.stop();return true;}
    if(playing.some(p=>p.manual))return false;
    return playing.length<Number(this.settings()['auto.concurrent']);
  }
  stopAll():void {for(const p of this.photos)p.stop();}
  destroy():void {for(const p of [...this.photos])p.destroy();}
}
export class Photo {
  playing=false; manual=false;
  private abort=new AbortController(); private timers=new Set<ReturnType<typeof setTimeout>>();
  private observer:IntersectionObserver; private resize:ResizeObserver;
  private video:HTMLVideoElement;private badge:HTMLSpanElement;private layer:HTMLSpanElement;
  private ratio=0;private pointer?:{x:number;y:number;type:string;at:number};private moved=false;
  private entered=false;private loops=0;private stoppedAt=0;private position=0;
  private tabIndex:string|null;private aria:string|null;private role:string|null;
  private parentPosition:string;private imageOpacity:string;
  private firedLongPress=false;
  constructor(private img:HTMLImageElement,private url:string,private config:()=>Config,private coordinator:PlaybackCoordinator,
    private previewed:()=>boolean,private remember:()=>void,private notice:(message:string)=>void,private release:()=>void,
    private host:'reading'|'preview'='reading') {
    const parent=img.parentElement;if(!parent)throw new Error('Detached image');
    this.parentPosition=parent.style.position;this.imageOpacity=img.style.opacity;
    if(getComputedStyle(parent).position==='static')parent.style.position='relative';
    this.layer=document.createElement('span');this.layer.className='live-media-photo-layer';
    this.video=document.createElement('video');this.video.controls=false;this.video.playsInline=true;
    this.video.disablePictureInPicture=true;this.video.disableRemotePlayback=true;this.video.preload='metadata';this.video.src=url;
    this.video.muted=true;this.video.setAttribute('aria-hidden','true');this.video.tabIndex=-1;
    this.badge=document.createElement('span');this.badge.className='live-media-badge';
    this.layer.append(this.video,this.badge);parent.append(this.layer);
    this.tabIndex=img.getAttribute('tabindex');this.aria=img.getAttribute('aria-label');this.role=img.getAttribute('role');
    const listen=<K extends keyof HTMLElementEventMap>(target:HTMLElement,name:K,fn:(e:HTMLElementEventMap[K])=>void,capture=false)=>target.addEventListener(name,fn as EventListener,{signal:this.abort.signal,capture});
    listen(img,'pointerdown',e=>{
      this.pointer={x:e.clientX,y:e.clientY,type:e.pointerType,at:Date.now()};this.moved=false;this.firedLongPress=false;
      if(this.config()['manual.gesture']==='long-press')this.schedule(()=>{if(!this.moved&&this.pointer){this.firedLongPress=true;this.action();}},Number(this.config()['gesture.longPressMs']));
    });
    listen(img,'pointermove',e=>{if(this.pointer){const tolerance=Number(this.config()[this.pointer.type==='touch'?'gesture.touchTolerancePx':'gesture.mouseTolerancePx']);
      if(Math.hypot(e.clientX-this.pointer.x,e.clientY-this.pointer.y)>tolerance)this.moved=true;}});
    listen(img,'pointercancel',()=>{this.moved=true;this.pointer=undefined;});
    listen(img,'dragstart',()=>{this.moved=true;});
    listen(img,'click',e=>this.click(e),true);
    listen(img,'dblclick',e=>{if(this.config()['manual.gesture']==='double-click'&&!this.moved&&!this.passthrough(e)){e.preventDefault();e.stopImmediatePropagation();this.action();}},true);
    listen(img,'keydown',e=>{if(!this.config()['accessibility.keyboard'])return;
      if(e.key==='Escape'){this.stop();e.preventDefault();}else if(e.key==='Enter'||e.key===' '){e.preventDefault();this.action();}});
    listen(img,'mouseenter',()=>{const c=this.config();if(c['auto.hover']&&c['auto.mode']!=='off')this.schedule(()=>{if(img.matches(':hover'))void this.play(false);},Number(c['auto.hoverDelayMs']));});
    listen(img,'mouseleave',()=>{if(!this.manual&&this.config()['auto.hoverEnd']==='stop')this.stop();});
    this.video.addEventListener('ended',()=>this.ended(),{signal:this.abort.signal});
    this.video.addEventListener('error',()=>{this.stop();this.notice('Live media could not be decoded by this WebView');},{signal:this.abort.signal});
    img.ownerDocument.addEventListener('visibilitychange',()=>{if(img.ownerDocument.hidden)this.stop();},{signal:this.abort.signal});
    img.ownerDocument.defaultView?.addEventListener('pagehide',()=>this.stop(),{signal:this.abort.signal});
    this.observer=new IntersectionObserver(entries=>{this.ratio=entries[0]?.intersectionRatio??0;this.visibility();},{threshold:[0,.1,.15,.25,.5,.6,.75,1]});
    this.observer.observe(img);this.resize=new ResizeObserver(()=>this.layout());this.resize.observe(img);
    listen(img,'load',()=>this.layout());this.coordinator.photos.add(this);this.refresh();this.layout();
  }
  private schedule(fn:()=>void,ms:number):void {const timer=setTimeout(()=>{this.timers.delete(timer);if(!this.abort.signal.aborted)fn();},ms);this.timers.add(timer);}
  private layout():void {const r=this.img.getBoundingClientRect(),p=this.img.parentElement!.getBoundingClientRect();Object.assign(this.layer.style,{left:(r.left-p.left)+'px',top:(r.top-p.top)+'px',width:r.width+'px',height:r.height+'px'});}
  refresh():void {
    const c=this.config();const reduced=!!c['accessibility.respectReducedMotion']&&matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.video.style.transition=`opacity ${reduced?0:c['appearance.transitionMs']}ms`;
    this.video.style.objectFit=getComputedStyle(this.img).objectFit||'contain';
    this.badge.textContent=String(c['badge.style'])==='ring'?'◉':String(c['badge.style'])==='text'?String(c['badge.text']):'◉ '+String(c['badge.text']);
    this.badge.style.display=c['badge.enabled']?'':'none';this.badge.style.opacity=String(c['badge.opacity']);
    this.badge.style.fontSize=String(c['badge.textPx'])+'px';this.badge.style.minHeight=String(c['badge.sizePx'])+'px';
    this.badge.style.borderRadius=String(c['badge.radiusPx'])+'px';
    this.badge.style.color=c['badge.color']==='theme'?'var(--text-normal)':String(c['badge.color']);
    this.badge.style.background=c['badge.background']==='theme'?'var(--background-primary)':String(c['badge.background']);
    for(const side of ['top','bottom','left','right'] as const)this.badge.style[side]='auto';
    for(const side of String(c['badge.position']).split('-'))this.badge.style.setProperty(side,String(c['badge.offsetPx'])+'px');
    this.layer.classList.toggle('live-media-hover-badge',c['badge.visibility']==='hover-focus');
    if(c['accessibility.keyboard']){this.img.tabIndex=0;this.img.setAttribute('role','button');this.img.setAttribute('aria-label',(this.img.alt||'Live photo')+'; Enter plays, Escape stops');}
    else{this.restoreAttribute('tabindex',this.tabIndex);this.restoreAttribute('role',this.role);this.restoreAttribute('aria-label',this.aria);}
    if(!c['manual.sound'])this.video.muted=true;
    if(c['auto.mode']==='off'&&!this.manual)this.stop();
  }
  private restoreAttribute(name:string,value:string|null):void {if(value===null)this.img.removeAttribute(name);else this.img.setAttribute(name,value);}
  private modifier(e:MouseEvent,key:string):boolean {return key==='alt'?e.altKey:key==='shift'?e.shiftKey:key==='ctrl-or-cmd'?(e.ctrlKey||e.metaKey):false;}
  private passthrough(e:MouseEvent):boolean {return this.modifier(e,String(this.config()['host.passthroughModifier']))||e.button!==0;}
  private click(e:MouseEvent):void {
    const c=this.config();if(!c['manual.enabled']||this.moved||this.passthrough(e))return;
    const gesture=c['manual.gesture'];
    const applies=gesture==='click'||(gesture==='modified-click'&&this.modifier(e,String(c['gesture.modifier'])))||(gesture==='long-press'&&this.firedLongPress);
    if(!applies)return;
    e.preventDefault();e.stopImmediatePropagation();if(!this.firedLongPress)this.action();this.pointer=undefined;
  }
  private action():void {if(!this.config()['manual.enabled'])return;
    if(this.playing&&this.manual&&this.config()['manual.repeatAction']==='stop')this.stop();else void this.play(true);}
  private visibility():void {
    const c=this.config();if(this.ratio<=Number(c['auto.exitRatio'])){this.entered=false;this.stop();return;}
    if(this.ratio>=Number(c['auto.enterRatio'])&&!this.entered){this.entered=true;
      if(c['auto.mode']!=='off'&&!(c['auto.mode']==='first-visible'&&this.previewed()))this.schedule(()=>{if(this.ratio>=Number(this.config()['auto.enterRatio']))void this.play(false);},Number(c['auto.delayMs']));}
  }
  async play(manual:boolean):Promise<void> {
    const c=this.config();
    if(this.img.ownerDocument.hidden||!this.img.isConnected)return;
    if(!manual){
      if(c['auto.mode']==='off'||Date.now()-this.stoppedAt<Number(c['auto.cooldownMs']))return;
      if(c['auto.scope']==='reading'&&this.host==='preview')return;
      if(c['accessibility.respectReducedMotion']&&matchMedia('(prefers-reduced-motion: reduce)').matches)return;
      if(!c['auto.mobile']&&matchMedia('(pointer: coarse)').matches)return;
    }
    if(!this.coordinator.admit(this,manual))return;
    this.manual=manual;this.playing=true;this.loops=0;
    this.video.currentTime=manual&&c['manual.resume']==='resume'?this.position:0;
    this.video.muted=!manual||!c['manual.sound'];this.video.volume=Number(c['manual.volumePercent'])/100;
    try{
      // Called before the first await so preloaded media retains genuine click activation.
      await this.video.play();
    }catch{
      if(!manual){this.stop();return;}
      this.video.muted=true;
      try{await this.video.play();this.notice('Sound was blocked; playing muted. Click again after stopping to allow sound.');}
      catch{this.stop();this.notice('Playback was blocked by this WebView');return;}
    }
    if(!this.playing)return;
    const show=()=>{if(this.playing){this.video.style.opacity='1';this.img.style.opacity='0';this.layer.classList.add('is-playing');}};
    if('requestVideoFrameCallback'in this.video)this.video.requestVideoFrameCallback(show);else requestAnimationFrame(show);
    if(!manual){this.remember();if(c['auto.durationMs']!=='full')this.schedule(()=>{if(!this.manual)this.stop();},Number(c['auto.durationMs']));}
  }
  private ended():void {
    this.loops++;const c=this.config();const count=this.manual?c['manual.loopCount']:c['auto.loopCount'];
    if(count==='continuous'||this.loops<Number(count)||(!this.manual&&c['auto.mode']==='visible-loop'&&this.ratio>=Number(c['auto.enterRatio']))){
      this.video.currentTime=0;if(!this.manual)this.video.muted=true;void this.video.play().catch(()=>this.stop());
    }else this.stop();
  }
  stop():void {this.position=this.video.currentTime;this.video.pause();this.video.muted=true;this.playing=false;this.manual=false;
    this.video.style.opacity='0';this.img.style.opacity=this.imageOpacity;this.layer.classList.remove('is-playing');this.stoppedAt=Date.now();}
  destroy():void {if(this.abort.signal.aborted)return;this.stop();this.abort.abort();for(const t of this.timers)clearTimeout(t);this.timers.clear();
    this.observer.disconnect();this.resize.disconnect();this.video.removeAttribute('src');this.video.load();this.layer.remove();
    this.restoreAttribute('tabindex',this.tabIndex);this.restoreAttribute('aria-label',this.aria);this.restoreAttribute('role',this.role);
    if(this.img.parentElement&&!this.img.parentElement.querySelector('.live-media-photo-layer'))this.img.parentElement.style.position=this.parentPosition;
    this.coordinator.photos.delete(this);this.release();}
}
