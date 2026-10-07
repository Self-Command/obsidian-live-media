// SPDX-License-Identifier: GPL-3.0-only
import type {Config} from '../settings/model';
/** A sibling overlay shares the image's layout coordinates and its own transform.
 * ResizeObserver alone cannot observe lightbox zoom/intro transform animations. */
export class PhotoGeometry {
  private resize:ResizeObserver;private mutation:MutationObserver;private abort=new AbortController();
  private frame?:number;private closed=false;private win:Window;
  constructor(private image:HTMLImageElement,private layer:HTMLElement,private video:HTMLVideoElement,private parent:HTMLElement,private badge:HTMLElement,private config:()=>Config){
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
    this.placeBadge(style);
  }
  private placeBadge(style:CSSStyleDeclaration):void {
    const img=this.image,number=(s:string)=>parseFloat(s)||0;
    const padding={left:number(style.paddingLeft),right:number(style.paddingRight),top:number(style.paddingTop),bottom:number(style.paddingBottom)};
    const width=Math.max(0,img.clientWidth-padding.left-padding.right),height=Math.max(0,img.clientHeight-padding.top-padding.bottom);
    let paintedWidth=width,paintedHeight=height;
    if(img.naturalWidth&&img.naturalHeight&&style.objectFit!=='fill'){
      let scale=style.objectFit==='cover'?Math.max(width/img.naturalWidth,height/img.naturalHeight):Math.min(width/img.naturalWidth,height/img.naturalHeight);
      if(style.objectFit==='none')scale=1;if(style.objectFit==='scale-down')scale=Math.min(1,scale);
      paintedWidth=img.naturalWidth*scale;paintedHeight=img.naturalHeight*scale;
    }
    const position=style.objectPosition.split(/\s+/),axis=(value:string|undefined,space:number)=>{
      if(value?.endsWith('%'))return space*number(value)/100;
      if(value?.endsWith('px'))return number(value);
      return value==='left'||value==='top'?0:value==='right'||value==='bottom'?space:space/2;
    };
    const x=axis(position[0],width-paintedWidth),y=axis(position[1],height-paintedHeight);
    const inset=Number(this.config()['badge.offsetPx']);
    const edges={left:padding.left+Math.max(0,x)+inset,right:padding.right+Math.max(0,width-x-paintedWidth)+inset,top:padding.top+Math.max(0,y)+inset,bottom:padding.bottom+Math.max(0,height-y-paintedHeight)+inset};
    for(const side of ['top','bottom','left','right']as const)this.badge.style[side]='auto';
    for(const side of String(this.config()['badge.position']).split('-')as Array<keyof typeof edges>)this.badge.style[side]=edges[side]+'px';
  }
  destroy():void {this.closed=true;if(this.frame!==undefined)this.win.cancelAnimationFrame(this.frame);this.resize.disconnect();this.mutation.disconnect();this.abort.abort();}
}
