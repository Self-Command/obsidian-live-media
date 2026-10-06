import {test,expect} from '@playwright/test';
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
