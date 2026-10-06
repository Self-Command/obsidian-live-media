import {test, expect} from '@playwright/test';
test('offline FFmpeg + UltraHDR load, decode, encode, cancel and reload', async ({page}) => {
  await page.goto('/tests/browser/index.html');
  await page.addScriptTag({url: '/dist/harness.js'});
  await page.route('**/*', route => route.abort());
  const result = await page.evaluate(async () => {
    const e = (window as unknown as {liveMediaHarness: {engine: {
      load(): Promise<void>; run(op: string, d: object): Promise<unknown>;
      encode(b: Uint8Array, ext: string, args: string[], outputExt?: string): Promise<Uint8Array>;
      validate(b: Uint8Array): Promise<void>; destroy(): void;
    }}}).liveMediaHarness.engine;
    await e.load();
    const hdr = await e.run('hdr-fixture', {}) as Uint8Array;
    const valid = await e.run('hdr-probe', {input: hdr});
    const compressed = await e.run('hdr-reencode', {input: hdr, quality: 70}) as Uint8Array;
    const validAfter = await e.run('hdr-probe', {input: compressed});
    const colorError=Number(await e.run('hdr-compare',{before:hdr,after:compressed}));
    const png = await e.encode(new Uint8Array(), 'png', ['-f','lavfi','-i','color=red:s=128x128','-frames:v','1','$OUTPUT']);
    await e.validate(png);
    const pending = e.encode(png, 'png', ['-loop','1','-i','$INPUT','-t','120','-c:v','libx264','$OUTPUT'], 'mp4');
    e.destroy();
    let cancelled = false;
    try {await pending;} catch {cancelled = true;}
    await e.load(); e.destroy();
    const oldLoad=e.load();e.destroy();const newLoad=e.load();let cancelledLoad=false;try{await oldLoad;}catch{cancelledLoad=true;}await newLoad;e.destroy();
    return {cancelledLoad,colorError,valid, validAfter, hdrBytes: hdr.length, compressedBytes: compressed.length, pngBytes: png.length, cancelled};
  });
  expect(result.valid).toBe(1); expect(result.validAfter).toBe(1);
  expect(result.pngBytes).toBeGreaterThan(50); expect(result.cancelled).toBe(true);
  expect(result.colorError).toBeGreaterThanOrEqual(0);expect(result.colorError).toBeLessThanOrEqual(.1);
  expect(result.cancelledLoad).toBe(true);
});

test('failed codec command discards its worker and the next valid operation starts clean',async({page})=>{
  await page.goto('/tests/browser/index.html');await page.addScriptTag({url:'/dist/harness.js'});
  const result=await page.evaluate(async()=>{
    const h=(window as any).liveMediaHarness,e=h.engine;let failed=false;
    try{await e.encode(Uint8Array.of(1,2,3,4),'jpg',['-v','error','-i','$INPUT','$OUTPUT']);}catch{failed=true;}
    const discarded=e.worker===undefined;
    const png=await e.encode(new Uint8Array(),'png',['-v','error','-f','lavfi','-i','color=red:s=128x128','-frames:v','1','$OUTPUT']);await e.validate(png);e.destroy();
    return {failed,discarded,bytes:png.length};
  });expect(result.failed).toBe(true);expect(result.discarded).toBe(true);expect(result.bytes).toBeGreaterThan(50);
});
test('full-resolution JPEG validation and repeated compression release each media worker',async({page})=>{
  await page.goto('/tests/browser/index.html');await page.addScriptTag({url:'/dist/harness.js'});
  const result=await page.evaluate(async()=>{
    const h=(window as any).liveMediaHarness,e=h.engine,c=h.defaults();
    const canvas=document.createElement('canvas');canvas.width=3072;canvas.height=4096;
    const ctx=canvas.getContext('2d')!,gradient=ctx.createLinearGradient(0,0,3072,4096);gradient.addColorStop(0,'#c86542');gradient.addColorStop(.5,'#5daa7c');gradient.addColorStop(1,'#527fb9');ctx.fillStyle=gradient;ctx.fillRect(0,0,3072,4096);
    const blob=await new Promise<Blob>(resolve=>canvas.toBlob(b=>resolve(b!),'image/jpeg',1));
    const input=h.addIcc(new Uint8Array(await blob.arrayBuffer()),h.profile());await e.validate(input);
    const checks=[];
    for(let i=0;i<6;i++){
      const encoded=await new h.Compressor(e).encode(input,'jpg',c,new AbortController().signal);
      checks.push(encoded.after.width===3072&&encoded.after.height===4096&&encoded.bytes.length<input.length&&e.worker===undefined);
    }
    canvas.width=canvas.height=0;return checks;
  });expect(result).toEqual([true,true,true,true,true,true]);
});
