import {test,expect} from '@playwright/test';
import {installPlaybackHost} from './playback-host';

test('right mouse viewer retains the host opening gesture and enlarged live image plays',async({page})=>{
  await installPlaybackHost(page);
  await page.evaluate(()=>{
    const h=(window as any).playbackHost,root=document.createElement('div');root.className='markdown-reading-view';document.body.append(root);const img=h.image();img.id='thumbnail';root.append(img);
    h.entries.post[0](root,{sourcePath:'note.md',addChild:()=>{}});
    img.addEventListener('contextmenu',(e:MouseEvent)=>{e.preventDefault();const viewer=document.createElement('section');viewer.className='host-image-viewer';viewer.setAttribute('role','dialog');const enlarged=h.image();enlarged.id='enlarged';viewer.append(enlarged);document.body.append(viewer);});
  });
  await expect(page.locator('.markdown-reading-view video')).toHaveCount(1);
  await page.locator('#thumbnail').click({button:'right'});
  await expect(page.locator('.host-image-viewer video')).toHaveCount(1);
  await page.locator('#enlarged').click();
  await expect.poll(()=>page.locator('.host-image-viewer video').evaluate(v=>(v as HTMLVideoElement).currentTime)).toBeGreaterThan(.05);
  expect(await page.locator('.host-image-viewer video').evaluate(v=>(v as HTMLVideoElement).controls)).toBe(false);
  expect(await page.locator('.host-image-viewer video').evaluate(v=>(v as HTMLVideoElement).muted)).toBe(false);
  await page.locator('#enlarged').click();expect(await page.locator('.host-image-viewer video').evaluate(v=>(v as HTMLVideoElement).paused)).toBe(true);
  await page.evaluate(()=>document.querySelector('.host-image-viewer')!.remove());await expect(page.locator('video')).toHaveCount(1);
  await page.evaluate(()=>(window as any).playbackHost.close());await expect(page.locator('video')).toHaveCount(0);
});

test('live preview mounts after late file info without reading-mode switch or CodeMirror transaction',async({page})=>{
  await installPlaybackHost(page,true);
  await page.evaluate(()=>{
    const h=(window as any).playbackHost,root=document.createElement('div');root.className='cm-editor';document.body.append(root);root.append(h.image());
    const info:any={file:undefined};const view={dom:root,state:{field:(field:unknown)=>field===h.infoField?info:true}};
    h.editor=new h.entries.extensions[0](view);h.editorRoot=root;h.info=info;
  });
  await expect(page.locator('video')).toHaveCount(0);
  // Merely fill the public file info; no artificial editor update or reading view.
  await page.evaluate(()=>{const h=(window as any).playbackHost;h.info.file=h.note;});
  await expect(page.locator('.cm-editor video')).toHaveCount(1);
  await expect.poll(()=>page.locator('video').evaluate(v=>(v as HTMLVideoElement).currentTime)).toBeGreaterThan(.05);
  expect(await page.locator('video').evaluate(v=>(v as HTMLVideoElement).muted)).toBe(true);
  // A post processor may also see a gallery widget: it must not attach twice.
  await page.evaluate(()=>{const h=(window as any).playbackHost;h.entries.post[0](h.editorRoot,{sourcePath:'note.md',addChild:()=>{}});});
  await expect(page.locator('video')).toHaveCount(1);
  await page.evaluate(()=>{const h=(window as any).playbackHost;h.editorRoot.querySelector('img').replaceWith(h.image());});
  await expect(page.locator('video')).toHaveCount(1);
  await page.evaluate(()=>{const h=(window as any).playbackHost;h.editor.destroy();h.close();});await expect(page.locator('video')).toHaveCount(0);
});
