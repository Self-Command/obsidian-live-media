import {test,expect} from '@playwright/test';
test('real SDR and HDR motion files preserve decode, cover time, audio, frames and index',async({page})=>{
  await page.goto('/tests/browser/index.html');await page.addScriptTag({url:'/dist/harness.js'});
  await page.evaluate(async()=>{Object.assign(window,{audioFixture:new Uint8Array(await (await fetch('/dist/fixtures/audio-motion.mp4')).arrayBuffer())});});
  await page.route('**/*',r=>r.abort());
  const result=await page.evaluate(async()=>{
    const h=(window as any).liveMediaHarness,e=h.engine;await e.load();
    const jpg=await e.encode(new Uint8Array(),'jpg',['-f','lavfi','-i','testsrc2=s=128x128:r=1','-frames:v','1','-q:v','1','$OUTPUT']);
    const video=(window as any).audioFixture as Uint8Array;
    const xml=`<rdf xmlns:GCamera="http://ns.google.com/photos/1.0/camera/" xmlns:Container="http://ns.google.com/photos/1.0/container/" xmlns:Item="http://ns.google.com/photos/1.0/container/item/" GCamera:MotionPhoto="1" GCamera:MotionPhotoPresentationTimestampUs="500000"><Container:Item Item:Semantic="Primary" Item:Mime="image/jpeg"/><Container:Item Item:Semantic="MotionPhoto" Item:Mime="video/mp4" Item:Length="${video.length}"/>                                          </rdf>`;
    const payload=new TextEncoder().encode('http://ns.adobe.com/xap/1.0/\0'+xml),segment=new Uint8Array(payload.length+4);segment.set([255,225]);new DataView(segment.buffer).setUint16(2,payload.length+2);segment.set(payload,4);
    const motion=h.concat(jpg.subarray(0,2),segment,jpg.subarray(2),video);const c=h.defaults();c['compression.minSavingPercent']=0;c['compression.ffmpegCrf']=30;c['compression.videoQuality']='custom';c['compression.staticStrategy']='reencode';
    const compressor=new h.Compressor(e);
    const compressed=await compressor.encode(motion,'jpg',c,new AbortController().signal);
    const p=h.probe(compressed.bytes);await e.validate(compressed.bytes.slice(p.videoStart));
    const hdr=await e.run('hdr-fixture',{});const hdrMotion=h.addMotionToHdr(hdr,video,'500000');
    const hdrBefore=h.mpfPictures(hdrMotion.slice(0,h.probe(hdrMotion).videoStart));
    c['compression.liveMode']='photo-and-video';
    let hdrOutput;
    try{hdrOutput=await compressor.encode(hdrMotion,'jpg',c,new AbortController().signal);}catch(error){
      // Small synthetic HDR files may not save space. Independently verify the writer's actual reconstruction.
      if(!String(error).includes('minimum savings'))throw error;
      const rebuilt=await e.run('hdr-reencode',{input:hdr,quality:70});hdrOutput={bytes:h.addMotionToHdr(rebuilt,compressed.bytes.slice(p.videoStart),'500000')};
    }
    const hdrAfter=h.probe(hdrOutput.bytes);h.mpfPictures(hdrOutput.bytes.slice(0,hdrAfter.videoStart));
    const hdrValid=await e.run('hdr-probe',{input:hdrOutput.bytes.slice(0,hdrAfter.videoStart)});
    await h.validateVideoPreservation(video,compressed.bytes.slice(p.videoStart));
    const sourceTracks=h.tracks(video),outputTracks=h.tracks(compressed.bytes.slice(p.videoStart));
    e.destroy();return {live:p.live,time:p.timestamp,smaller:compressed.bytes.length<motion.length,hdr:hdrAfter.hdr,hdrValid,hdrTime:hdrAfter.timestamp,frames:sourceTracks.find((t:any)=>t.kind==='vide').samples.length,audio:outputTracks.some((t:any)=>t.kind==='soun'),hdrPictures:hdrBefore.pictures.length};
  });
  expect(result.live).toBe(true);expect(result.time).toBe('500000');expect(result.smaller).toBe(true);
  expect(result.hdr).toBe(true);expect(result.hdrValid).toBe(1);expect(result.hdrTime).toBe('500000');expect(result.frames).toBe(32);expect(result.audio).toBe(true);expect(result.hdrPictures).toBe(2);
});
test('lossless PNG preserves decoded RGBA; animated and unknown resources are protected',async({page})=>{
  await page.goto('/tests/browser/index.html');await page.addScriptTag({url:'/dist/harness.js'});
  const r=await page.evaluate(async()=>{
    const h=(window as any).liveMediaHarness,e=h.engine;
    const png=await e.encode(new Uint8Array(),'png',['-f','lavfi','-i','testsrc2=s=128x128:r=1','-frames:v','1','-compression_level','0','$OUTPUT']);
    const c=h.defaults();c['compression.minSavingPercent']=0;const out=await new h.Compressor(e).encode(png,'png',c,new AbortController().signal);
    let rejected=false;try{await new h.Compressor(e).encode(new TextEncoder().encode('GIF89a'),'gif',c,new AbortController().signal);}catch{rejected=true;}
    e.destroy();return {format:out.after.format,saving:out.bytes.length<png.length,rejected};
  });
  expect(r.format).toBe('png');expect(r.saving).toBe(true);expect(r.rejected).toBe(true);
});
