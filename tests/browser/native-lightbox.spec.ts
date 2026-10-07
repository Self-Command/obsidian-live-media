import {test,expect,type Page} from '@playwright/test';
import {existsSync} from 'node:fs';
import {installPlaybackHost} from './playback-host';

/** Independently authored host model: full-size padded img is transformed from
 * thumbnail position, then zoomed/panned. No Obsidian application code copied. */
async function openLightbox(page:Page,baseline=false):Promise<void>{
  await installPlaybackHost(page,false,baseline);
  await page.addStyleTag({content:`
    .lightbox{position:fixed;inset:0;z-index:50;background:black}
    .lightbox-content,.lightbox-media{position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden}
    .media-wrapper{position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center}
    .lightbox img{box-sizing:border-box;width:min(960px,85vw);height:min(600px,85vh);padding:8px;object-fit:contain;will-change:transform}
  `});
  await page.evaluate(()=>{
    const h=(window as any).playbackHost,root=document.createElement('div');root.className='markdown-reading-view';document.body.append(root);
    const thumbnail=h.image();thumbnail.id='source';thumbnail.width=128;thumbnail.height=96;root.append(thumbnail);h.entries.post[0](root,{sourcePath:'note.md',addChild:()=>{}});
    thumbnail.addEventListener('contextmenu',(e:MouseEvent)=>{
      e.preventDefault();const box=document.createElement('div');box.className='lightbox';const content=document.createElement('div');content.className='lightbox-content';const media=document.createElement('div');media.className='lightbox-media';const wrapper=document.createElement('div');wrapper.className='media-wrapper';
      const img=h.image();img.id='full-size';img.style.transform='translate(180px, 80px) scale(0.2)';wrapper.append(img);media.append(wrapper);content.append(media);box.append(content);document.body.append(box);
      h.viewer={box,img,wrapper,media,pointerDowns:0};wrapper.addEventListener('pointerdown',()=>h.viewer.pointerDowns++);
    });
    h.geometryError=()=>{const img=h.viewer.img.getBoundingClientRect(),layer=h.viewer.img.parentElement.querySelector('.live-media-photo-layer').getBoundingClientRect();return Math.max(...['left','top','width','height'].map(k=>Math.abs(img[k]-layer[k])));};
  });
  await expect(page.locator('.markdown-reading-view video')).toHaveCount(1);
  await page.locator('#source').click({button:'right'});
  await expect(page.locator('.lightbox video')).toHaveCount(1);
}

test('previous artifact reproduces a tiny playback layer stranded on the enlarged photo',async({page},info)=>{
  test.skip(!existsSync('dist/baseline/main.js'),'Previous Actions artifact has expired; current geometry regressions remain mandatory.');
  await openLightbox(page,true);
  await page.locator('#full-size').click();
  await page.evaluate(()=>{const img=(window as any).playbackHost.viewer.img;img.style.transition='transform 300ms linear';img.style.transform='translate(0, 0) scale(1)';});
  await expect.poll(()=>page.locator('#full-size').evaluate(img=>img.getBoundingClientRect().width)).toBeGreaterThan(800);
  await expect.poll(()=>page.evaluate(()=>(window as any).playbackHost.geometryError())).toBeGreaterThan(400);
  await info.attach('previous-0.1.5-small-overlay',{body:await page.screenshot(),contentType:'image/png'});
  await page.evaluate(()=>(window as any).playbackHost.close());
});

test('full-size playing layer follows animated opening, zoom, padding and ancestor transforms',async({page},info)=>{
  await openLightbox(page);
  await expect.poll(()=>page.evaluate(()=>(window as any).playbackHost.geometryError())).toBeLessThan(1);
  await page.locator('#full-size').click();await expect.poll(()=>page.locator('.lightbox video').evaluate(v=>(v as HTMLVideoElement).currentTime)).toBeGreaterThan(.05);
  await page.evaluate(()=>{const img=(window as any).playbackHost.viewer.img;img.style.transition='transform 600ms linear';img.style.transform='translate(0, 0) scale(1)';});
  await expect.poll(()=>page.locator('#full-size').evaluate(img=>img.getAnimations().some(a=>a.playState==='running'))).toBe(true);
  const errors=await page.evaluate(async()=>{
    const h=(window as any).playbackHost,errors:number[]=[];
    for(let i=0;i<18;i++){await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));errors.push(h.geometryError());}return errors;
  });
  expect(Math.max(...errors)).toBeLessThan(2);
  await expect.poll(()=>page.locator('#full-size').evaluate(img=>img.getAnimations().some(a=>a.playState==='running'))).toBe(false);
  await expect.poll(()=>page.evaluate(()=>(window as any).playbackHost.geometryError())).toBeLessThan(1);
  await page.evaluate(()=>{const h=(window as any).playbackHost;h.viewer.img.style.transition='';h.viewer.img.style.transform='translate(45px, 30px) scale(1.4) rotate(12deg)';h.viewer.wrapper.style.transform='translate(-20px, 5px) scale(0.85)';});
  await expect.poll(()=>page.evaluate(()=>(window as any).playbackHost.geometryError())).toBeLessThan(1);
  expect(await page.locator('.lightbox video').evaluate(v=>(v as HTMLVideoElement).controls)).toBe(false);
  expect(await page.evaluate(()=>(window as any).playbackHost.viewer.pointerDowns)).toBeGreaterThan(0);
  await info.attach('current-0.1.6-aligned-zoom-playback',{body:await page.screenshot(),contentType:'image/png'});
  await page.setViewportSize({width:900,height:650});
  await expect.poll(()=>page.evaluate(()=>(window as any).playbackHost.geometryError())).toBeLessThan(1);
  await page.evaluate(()=>{const h=(window as any).playbackHost;h.viewer.box.remove();});await expect(page.locator('video')).toHaveCount(1);
  await page.evaluate(()=>(window as any).playbackHost.close());await expect(page.locator('video')).toHaveCount(0);
});

test('viewer reparenting rebuilds the overlay and preserves native pan instead of starting playback',async({page})=>{
  await openLightbox(page);
  await page.evaluate(()=>{const h=(window as any).playbackHost;h.viewer.img.style.transform='none';const next=document.createElement('div');next.className='media-wrapper';h.viewer.media.append(next);next.append(h.viewer.img);});
  await expect(page.locator('.lightbox video')).toHaveCount(1);
  await expect.poll(()=>page.evaluate(()=>(window as any).playbackHost.geometryError())).toBeLessThan(1);
  await page.evaluate(()=>{
    const h=(window as any).playbackHost,img=h.viewer.img;img.parentElement.addEventListener('pointermove',()=>{img.style.transform='translate(45px, 20px) scale(1.1)';});
    img.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,isPrimary:true,pointerType:'mouse',button:0,clientX:200,clientY:200}));
    img.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:1,pointerType:'mouse',buttons:1,clientX:260,clientY:200}));
    img.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,pointerType:'mouse',button:0}));img.click();
  });
  expect(await page.locator('.lightbox video').evaluate(v=>(v as HTMLVideoElement).paused)).toBe(true);
  await expect.poll(()=>page.evaluate(()=>(window as any).playbackHost.geometryError())).toBeLessThan(1);
  await page.evaluate(()=>(window as any).playbackHost.close());await expect(page.locator('video')).toHaveCount(0);
});

test('all visible LIVE photos actually decode and play concurrently with silence then stop offscreen',async({page})=>{
  await installPlaybackHost(page,true);
  await page.evaluate(()=>{
    const h=(window as any).playbackHost;h.plugin.model.set('auto.concurrent','all-visible');h.plugin.model.set('auto.lowResource','keep-configured');h.plugin.model.set('auto.loopCount',10);h.plugin.model.set('auto.durationMs','full');
    const root=document.createElement('div');root.className='markdown-reading-view';root.style.display='flex';document.body.append(root);h.concurrentRoot=root;
    for(let i=0;i<3;i++){const frame=document.createElement('div');const img=h.image();img.width=160;img.height=120;frame.append(img);root.append(frame);}h.entries.post[0](root,{sourcePath:'note.md',addChild:()=>{}});
  });
  await expect(page.locator('video')).toHaveCount(3);
  await expect.poll(()=>page.locator('video').evaluateAll(videos=>videos.every(v=>{const video=v as HTMLVideoElement;return !video.paused&&video.currentTime>.05&&video.muted;}))).toBe(true);
  await page.evaluate(()=>(window as any).playbackHost.concurrentRoot.style.marginTop='2000px');
  await expect.poll(()=>page.locator('video').evaluateAll(videos=>videos.every(v=>(v as HTMLVideoElement).paused))).toBe(true);
  await page.evaluate(()=>(window as any).playbackHost.close());await expect(page.locator('video')).toHaveCount(0);
});

test('LIVE badge stays inset inside actual photo pixels, excluding lightbox padding and contain bars',async({page},info)=>{
  await openLightbox(page);
  await page.evaluate(()=>{const h=(window as any).playbackHost;h.viewer.img.style.transform='none';h.badgeInsets=()=>{
    const img=h.viewer.img,style=getComputedStyle(img),r=img.getBoundingClientRect(),badge=img.parentElement.querySelector('.live-media-badge').getBoundingClientRect();
    const sx=r.width/img.offsetWidth,sy=r.height/img.offsetHeight,pl=parseFloat(style.paddingLeft),pr=parseFloat(style.paddingRight),pt=parseFloat(style.paddingTop),pb=parseFloat(style.paddingBottom);
    const w=img.clientWidth-pl-pr,contentHeight=img.clientHeight-pt-pb,k=Math.min(w/img.naturalWidth,contentHeight/img.naturalHeight),paintW=img.naturalWidth*k,paintH=img.naturalHeight*k;
    return {right:(r.left+(pl+(w-paintW)/2+paintW)*sx-badge.right)/sx,top:(badge.top-(r.top+(pt+(contentHeight-paintH)/2)*sy))/sy};
  };});
  await expect.poll(()=>page.evaluate(()=>(window as any).playbackHost.badgeInsets().right)).toBeGreaterThan(7);
  await expect.poll(()=>page.evaluate(()=>(window as any).playbackHost.badgeInsets().top)).toBeGreaterThan(7);
  expect(await page.evaluate(()=>(window as any).playbackHost.badgeInsets().right)).toBeLessThan(9);
  await page.locator('#full-size').click();await expect.poll(()=>page.locator('.lightbox video').evaluate(v=>(v as HTMLVideoElement).currentTime)).toBeGreaterThan(.05);
  await page.evaluate(()=>{const h=(window as any).playbackHost;h.viewer.img.style.transform='translate(10px, 15px) scale(1.15)';h.plugin.model.set('badge.offsetPx',14);h.plugin.hosts.settingsChanged();});
  await expect.poll(()=>page.evaluate(()=>(window as any).playbackHost.badgeInsets().right)).toBeGreaterThan(13);
  expect(await page.evaluate(()=>(window as any).playbackHost.badgeInsets().top)).toBeLessThan(15);
  await info.attach('LIVE-inset-inside-photo',{body:await page.screenshot(),contentType:'image/png'});
  await page.evaluate(()=>(window as any).playbackHost.close());
});
