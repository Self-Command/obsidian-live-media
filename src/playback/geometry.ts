// SPDX-License-Identifier: GPL-3.0-only
/** A sibling overlay shares the image's layout coordinates and its own transform.
 * ResizeObserver alone cannot observe lightbox zoom/intro transform animations. */
export class PhotoGeometry {
  private resize:ResizeObserver;private mutation:MutationObserver;private abort=new AbortController();
  private frame?:number;private closed=false;private win:Window;
  constructor(private image:HTMLImageElement,private layer:HTMLElement,private video:HTMLVideoElement,private parent:HTMLElement){
    this.win=image.ownerDocument.defaultView??window;
    this.resize=new ResizeObserver(()=>this.refresh());this.resize.observe(image);this.resize.observe(parent);
    this.mutation=new MutationObserver(()=>this.refresh());
    for(let node:HTMLElement|null=image;node;node=node.parentElement)this.mutation.observe(node,{attributes:true,attributeFilter:['style','class']});
    const refresh=()=>this.refresh();
    image.addEventListener('load',refresh,{signal:this.abort.signal});
    image.addEventListener('transitionrun',refresh,{signal:this.abort.signal});
    image.addEventListener('animationstart',refresh,{signal:this.abort.signal});
    this.win.addEventListener('resize',refresh,{signal:this.abort.signal});
    this.win.addEventListener('scroll',refresh,{capture:true,passive:true,signal:this.abort.signal});
    this.win.visualViewport?.addEventListener('resize',refresh,{signal:this.abort.signal});
    this.refresh();
  }
  refresh():void {if(this.closed)return;this.layout();
    if(this.frame===undefined&&this.image.getAnimations?.().some(a=>a.playState==='running'))this.frame=this.win.requestAnimationFrame(()=>{this.frame=undefined;this.refresh();});
  }
  private layout():void {
    const img=this.image,parent=this.parent;if(!img.isConnected||img.parentElement!==parent)return;
    const style=this.win.getComputedStyle(img);
    Object.assign(this.layer.style,{boxSizing:'border-box',margin:'0',padding:style.padding,borderStyle:'solid',borderColor:'transparent',borderWidth:style.borderWidth,borderRadius:style.borderRadius,opacity:style.opacity});
    if(img.offsetParent===this.layer.offsetParent){
      // Preserve the border box and padding, so the video paints exactly where
      // the image pixels paint. Native zoom transforms target img, not wrapper.
      Object.assign(this.layer.style,{position:'absolute',left:img.offsetLeft+'px',top:img.offsetTop+'px',width:img.offsetWidth+'px',height:img.offsetHeight+'px',transform:style.transform,transformOrigin:style.transformOrigin});
    }else{
      const r=img.getBoundingClientRect(),p=parent.getBoundingClientRect();
      const sx=parent.offsetWidth?p.width/parent.offsetWidth:1,sy=parent.offsetHeight?p.height/parent.offsetHeight:1;
      Object.assign(this.layer.style,{position:'absolute',left:((r.left-p.left)/(sx||1)-parent.clientLeft+parent.scrollLeft)+'px',top:((r.top-p.top)/(sy||1)-parent.clientTop+parent.scrollTop)+'px',width:r.width/(sx||1)+'px',height:r.height/(sy||1)+'px',transform:'none',transformOrigin:'50% 50%'});
    }
    this.video.style.objectFit=style.objectFit||'contain';this.video.style.objectPosition=style.objectPosition;
  }
  destroy():void {this.closed=true;if(this.frame!==undefined)this.win.cancelAnimationFrame(this.frame);this.resize.disconnect();this.mutation.disconnect();this.abort.abort();}
}
