import {test,expect} from '@playwright/test';
test('real decoded Motion Photo keeps layout and caption while automatic preview stays muted',async({page})=>{
  await page.goto('/tests/browser/index.html');await page.addScriptTag({url:'/dist/harness.js'});await page.addStyleTag({url:'/dist/styles.css'});
  await page.evaluate(async()=>{
    const h=(window as any).liveMediaHarness,bytes=new Uint8Array(await(await fetch('/dist/fixtures/motion.jpg')).arrayBuffer()),p=h.probe(bytes),c=h.defaults();
    c['auto.delayMs']=0;c['auto.durationMs']=300;c['auto.cooldownMs']=0;
    const figure=document.createElement('figure');figure.style.width='240px';document.body.append(figure);const img=document.createElement('img');img.style.width='240px';img.style.height='240px';img.alt='Synthetic photo';figure.append(img);const caption=document.createElement('figcaption');caption.textContent='Caption retained';figure.append(caption);
    img.src=URL.createObjectURL(new Blob([bytes]));await img.decode();
    const url=URL.createObjectURL(new Blob([bytes.slice(p.videoStart)],{type:'video/mp4'})),coord=new h.PlaybackCoordinator(()=>c);
    const photo=new h.Photo(img,url,()=>c,coord,()=>false,()=>{},()=>{},()=>URL.revokeObjectURL(url));Object.assign(window,{realPhoto:{photo,img,c,coord}});
  });
  await expect.poll(()=>page.locator('video').evaluate(v=>(v as HTMLVideoElement).muted)).toBe(true);
  await expect.poll(()=>page.locator('video').evaluate(v=>(v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
  const before=await page.locator('figure').boundingBox();await page.locator('img').click();
  await expect.poll(()=>page.locator('video').evaluate(v=>getComputedStyle(v).opacity)).toBe('1');
  expect(await page.locator('figure').boundingBox()).toEqual(before);await expect(page.locator('figcaption')).toHaveText('Caption retained');
  expect(await page.locator('video').evaluate(v=>(v as HTMLVideoElement).controls)).toBe(false);
  await page.evaluate(()=>{const t=(window as any).realPhoto;t.photo.destroy();URL.revokeObjectURL(t.img.src);});await expect(page.locator('video')).toHaveCount(0);
});
test('photo layer never has controls; auto is muted, repeated clicks stop, drag and modifiers pass through',async({page})=>{
  await page.goto('/tests/browser/index.html');await page.addScriptTag({url:'/dist/harness.js'});
  await page.addStyleTag({url:'/dist/styles.css'});
  await page.evaluate(()=>{
    const h=(window as any).liveMediaHarness;const c=h.defaults();c['auto.mode']='off';
    const img=document.createElement('img');img.src='data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"></svg>';img.style.width='128px';img.style.height='128px';document.body.append(img);
    const coord=new h.PlaybackCoordinator(()=>c);
    const photo=new h.Photo(img,'',()=>c,coord,()=>false,()=>{},()=>{},()=>{});
    // Exercise interaction logic; codec decode is separately tested with actual encoded media.
    const video=document.querySelector('video')!;
    video.removeAttribute('src');
    video.play=async()=>{};video.pause=()=>{};
    Object.assign(window,{testPhoto:{photo,c,img,video,coord}});
  });
  const img=page.locator('img');await img.click();
  expect(await page.evaluate(()=>(window as any).testPhoto.video.controls)).toBe(false);
  expect(await page.evaluate(()=>(window as any).testPhoto.video.muted)).toBe(false);
  await img.click();expect(await page.evaluate(()=>(window as any).testPhoto.photo.playing)).toBe(false);
  await page.evaluate(async()=>{const t=(window as any).testPhoto;t.c['auto.mode']='every-enter';t.c['auto.cooldownMs']=0;await t.photo.play(false);});
  expect(await page.evaluate(()=>(window as any).testPhoto.video.muted)).toBe(true);
  await page.evaluate(()=>{const t=(window as any).testPhoto;t.photo.stop();t.img.dispatchEvent(new PointerEvent('pointerdown',{clientX:0,clientY:0,pointerType:'mouse'}));t.img.dispatchEvent(new PointerEvent('pointermove',{clientX:50,clientY:0,pointerType:'mouse'}));t.img.click();});
  expect(await page.evaluate(()=>(window as any).testPhoto.photo.playing)).toBe(false);
  await page.evaluate(()=>{const t=(window as any).testPhoto;t.img.dispatchEvent(new PointerEvent('pointerdown',{clientX:0,clientY:0,pointerType:'mouse'}));t.img.dispatchEvent(new MouseEvent('click',{altKey:true}));});
  expect(await page.evaluate(()=>(window as any).testPhoto.photo.playing)).toBe(false);
  await page.evaluate(()=>{const t=(window as any).testPhoto;t.photo.destroy();});
  await expect(page.locator('video')).toHaveCount(0);await expect(page.locator('img')).toHaveCount(1);
});
test('theme variables update LIVE appearance and repeated mount/unmount releases every photo',async({page})=>{
  await page.goto('/tests/browser/index.html');await page.addScriptTag({url:'/dist/harness.js'});await page.addStyleTag({url:'/dist/styles.css'});
  const result=await page.evaluate(()=>{
    const h=(window as any).liveMediaHarness,c=h.defaults();c['auto.mode']='off';const coord=new h.PlaybackCoordinator(()=>c);let releases=0;
    const colors=[];
    for(const color of ['rgb(20, 30, 40)','rgb(230, 235, 240)']){
      document.documentElement.style.setProperty('--text-normal',color);
      const box=document.createElement('div');document.body.append(box);const images=[document.createElement('img'),document.createElement('img')];box.append(...images);
      const photos=images.map(img=>new h.Photo(img,'',()=>c,coord,()=>false,()=>{},()=>{},()=>releases++));
      colors.push(getComputedStyle(box.querySelector('.live-media-badge')!).color);photos.forEach(p=>p.destroy());if(box.style.position!=='')throw new Error('Parent layout not restored');box.remove();
    }
    for(let i=0;i<20;i++){const box=document.createElement('div');document.body.append(box);const img=document.createElement('img');box.append(img);const photo=new h.Photo(img,'',()=>c,coord,()=>false,()=>{},()=>{},()=>releases++);photo.destroy();box.remove();}
    return {colors,releases,remaining:coord.photos.size,videos:document.querySelectorAll('video').length};
  });expect(result).toEqual({colors:['rgb(20, 30, 40)','rgb(230, 235, 240)'],releases:24,remaining:0,videos:0});
});
test('sound denial falls back to muted without adding controls and a manual photo blocks automatic competition',async({page})=>{
  await page.goto('/tests/browser/index.html');await page.addScriptTag({url:'/dist/harness.js'});
  const result=await page.evaluate(async()=>{
    const h=(window as any).liveMediaHarness,c=h.defaults();c['auto.mode']='every-enter';c['auto.cooldownMs']=0;c['auto.delayMs']=60000;const coord=new h.PlaybackCoordinator(()=>c),notices:string[]=[];
    const photos=[0,1].map(()=>{const box=document.createElement('div');document.body.append(box);const img=document.createElement('img');box.append(img);return new h.Photo(img,'',()=>c,coord,()=>false,()=>{},(s:string)=>notices.push(s),()=>{});});
    const videos=[...document.querySelectorAll('video')];const attempts:boolean[]=[];
    videos[0]!.removeAttribute('src');videos[0]!.pause=()=>{};videos[0]!.play=async()=>{attempts.push(videos[0]!.muted);if(!videos[0]!.muted)throw new DOMException('Denied','NotAllowedError');};
    videos[1]!.removeAttribute('src');videos[1]!.pause=()=>{};videos[1]!.play=async()=>{};
    await photos[0]!.play(true);await photos[1]!.play(false);const blocked=!photos[1]!.playing;
    const controls=videos.some(v=>v.controls);photos.forEach(p=>p.destroy());return {attempts,blocked,controls,notices:notices.length};
  });expect(result).toEqual({attempts:[false,true],blocked:true,controls:false,notices:1});
});
test('long press cancels on release, multi-touch stays native, keyboard and unload preserve host styling',async({page})=>{
  await page.goto('/tests/browser/index.html');await page.addScriptTag({url:'/dist/harness.js'});await page.addStyleTag({url:'/dist/styles.css'});
  const result=await page.evaluate(async()=>{
    const h=(window as any).liveMediaHarness,c=h.defaults();c['auto.mode']='off';c['manual.gesture']='long-press';c['gesture.longPressMs']=300;
    const parent=document.createElement('div');document.body.append(parent);const img=document.createElement('img');parent.append(img);img.style.width='128px';img.style.height='128px';
    const coord=new h.PlaybackCoordinator(()=>c),photo=new h.Photo(img,'',()=>c,coord,()=>false,()=>{},()=>{},()=>{});
    const video=parent.querySelector('video')!;video.removeAttribute('src');video.play=async()=>{};video.pause=()=>{};
    const event=(type:string,id=1,primary=true)=>new PointerEvent(type,{bubbles:true,pointerId:id,isPrimary:primary,pointerType:'touch',button:0});
    img.dispatchEvent(event('pointerdown'));img.dispatchEvent(event('pointerup'));await new Promise(r=>setTimeout(r,350));const early=photo.playing;
    img.dispatchEvent(event('pointerdown'));img.dispatchEvent(event('pointerdown',2,false));await new Promise(r=>setTimeout(r,350));const multi=photo.playing;
    img.dispatchEvent(event('pointerup'));img.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}));await Promise.resolve();const keyboard=photo.playing;
    img.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));const stopped=!photo.playing;
    photo.destroy();return {early,multi,keyboard,stopped,position:parent.style.position,role:img.getAttribute('role'),layers:parent.querySelectorAll('video,.live-media-badge').length};
  });
  expect(result).toEqual({early:false,multi:false,keyboard:true,stopped:true,position:'',role:null,layers:0});
});

test('press-time image viewer cannot consume live click; modifier and ordinary photos retain viewer behavior',async({page})=>{
  await page.goto('/tests/browser/index.html');await page.addScriptTag({url:'/dist/harness.js'});
  await page.addStyleTag({url:'/dist/styles.css'});
  await page.evaluate(()=>{
    const h=(window as any).liveMediaHarness,c=h.defaults();c['auto.mode']='off';
    const figure=document.createElement('figure'),img=document.createElement('img');img.id='live';img.width=128;img.height=128;img.src='data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"></svg>';figure.append(img);document.body.append(figure);
    const ordinary=img.cloneNode()as HTMLImageElement;ordinary.id='ordinary';document.body.append(ordinary);
    const state={opened:0,photo:null as any};
    // Register BEFORE Photo, at the document capture phase, as a press-driven host.
    document.addEventListener('mousedown',()=>{state.opened++;},{capture:true});
    document.addEventListener('pointerdown',()=>{state.opened++;},{capture:true});
    const coord=new h.PlaybackCoordinator(()=>c),photo=new h.Photo(img,'',()=>c,coord,()=>false,()=>{},()=>{},()=>{});
    const video=figure.querySelector('video')!;video.removeAttribute('src');video.play=async()=>{};video.pause=()=>{};
    state.photo=photo;Object.assign(window,{pressHost:state});
  });
  await page.locator('#live').click();expect(await page.evaluate(()=>(window as any).pressHost.opened)).toBe(0);
  expect(await page.evaluate(()=>(window as any).pressHost.photo.playing)).toBe(true);
  await page.locator('#live').click();expect(await page.evaluate(()=>(window as any).pressHost.photo.playing)).toBe(false);
  await page.locator('#live').click({modifiers:['Alt']});expect(await page.evaluate(()=>(window as any).pressHost.opened)).toBe(2);
  await page.locator('#ordinary').click();expect(await page.evaluate(()=>(window as any).pressHost.opened)).toBe(4);
  await page.evaluate(()=>(window as any).pressHost.photo.destroy());
  await page.locator('#live').click();expect(await page.evaluate(()=>(window as any).pressHost.opened)).toBe(6);
});

test('visible automatic previews queue instead of dropping and all attempts remain muted',async({page})=>{
  await page.goto('/tests/browser/index.html');await page.addScriptTag({url:'/dist/harness.js'});await page.addStyleTag({url:'/dist/styles.css'});
  await page.evaluate(()=>{
    const h=(window as any).liveMediaHarness,c=h.defaults();c['auto.mode']='every-enter';c['auto.delayMs']=0;c['auto.cooldownMs']=0;c['auto.durationMs']='full';c['auto.concurrent']=1;
    const coord=new h.PlaybackCoordinator(()=>c),calls:number[]=[],sound:boolean[]=[];
    const photos=[0,1,2].map(index=>{
      const box=document.createElement('div');box.style.display='inline-block';document.body.append(box);const img=document.createElement('img');img.width=128;img.height=128;img.src='data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"></svg>';box.append(img);
      const photo=new h.Photo(img,'',()=>c,coord,()=>false,()=>{},()=>{},()=>{});const v=box.querySelector('video')!;
      v.removeAttribute('src');v.play=async()=>{calls.push(index);sound.push(v.muted);};v.pause=()=>{};return photo;
    });Object.assign(window,{autoQueue:{coord,calls,sound,photos}});
  });
  await expect.poll(()=>page.evaluate(()=>(window as any).autoQueue.calls.length)).toBe(1);
  await page.evaluate(()=>{const t=(window as any).autoQueue;t.photos[t.calls[0]].video.dispatchEvent(new Event('ended'));});
  await expect.poll(()=>page.evaluate(()=>(window as any).autoQueue.calls.length)).toBe(2);
  await page.evaluate(()=>{const t=(window as any).autoQueue;t.photos[t.calls[1]].video.dispatchEvent(new Event('ended'));});
  await expect.poll(()=>page.evaluate(()=>(window as any).autoQueue.calls.length)).toBe(3);
  expect(await page.evaluate(()=>(window as any).autoQueue.sound)).toEqual([true,true,true]);
  expect(await page.evaluate(()=>new Set((window as any).autoQueue.calls).size)).toBe(3);
  await page.evaluate(()=>(window as any).autoQueue.coord.destroy());await expect(page.locator('video')).toHaveCount(0);
});

test('tall photo previews on first visibility without a false startup cooldown',async({page})=>{
  await page.goto('/tests/browser/index.html');await page.addScriptTag({url:'/dist/harness.js'});await page.addStyleTag({url:'/dist/styles.css'});
  await page.evaluate(()=>{
    const h=(window as any).liveMediaHarness,c=h.defaults();c['auto.delayMs']=0;c['auto.durationMs']='full';c['auto.cooldownMs']=60000;
    const box=document.createElement('div');document.body.append(box);const img=document.createElement('img');img.width=200;img.height=2000;img.src='data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="2000"></svg>';box.append(img);
    const coord=new h.PlaybackCoordinator(()=>c),photo=new h.Photo(img,'',()=>c,coord,()=>false,()=>{},()=>{},()=>{});const video=box.querySelector('video')!;
    video.removeAttribute('src');video.pause=()=>{};video.play=async()=>{};
    photo.stop();Object.assign(window,{tallPhoto:{coord,photo,video}});
  });
  await expect.poll(()=>page.evaluate(()=>(window as any).tallPhoto.photo.playing)).toBe(true);
  expect(await page.evaluate(()=>(window as any).tallPhoto.video.muted)).toBe(true);
  await page.evaluate(()=>(window as any).tallPhoto.coord.destroy());
});
