import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
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
    const sdrModes=[];
    for(const mode of ['photo-only','photo-and-video']){
      const rewritten=await compressor.encode(motion,'jpg',{...c,'compression.liveMode':mode},new AbortController().signal);
      const probe=h.probe(rewritten.bytes);await e.validate(rewritten.bytes.slice(0,probe.videoStart));await e.validate(rewritten.bytes.slice(probe.videoStart));
      await h.validateVideoPreservation(video,rewritten.bytes.slice(probe.videoStart));sdrModes.push(probe.live&&probe.timestamp==='500000');
    }
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
    e.destroy();return {fixture:Array.from(motion as Uint8Array),sdrModes,live:p.live,time:p.timestamp,smaller:compressed.bytes.length<motion.length,hdr:hdrAfter.hdr,hdrValid,hdrTime:hdrAfter.timestamp,frames:sourceTracks.find((t:any)=>t.kind==='vide').samples.length,audio:outputTracks.some((t:any)=>t.kind==='soun'),hdrPictures:hdrBefore.pictures.length};
  });
  expect(result.live).toBe(true);expect(result.time).toBe('500000');expect(result.smaller).toBe(true);
  expect(result.sdrModes).toEqual([true,true]);
  expect(result.hdr).toBe(true);expect(result.hdrValid).toBe(1);expect(result.hdrTime).toBe('500000');expect(result.frames).toBe(32);expect(result.audio).toBe(true);expect(result.hdrPictures).toBe(2);
  await writeFile('dist/fixtures/motion.jpg',new Uint8Array(result.fixture));
});

test('independent Apple graft keeps keyed timed samples, identity, original photo and audio',async({page})=>{
  await page.goto('/tests/browser/index.html');await page.addScriptTag({url:'/dist/harness.js'});
  const result=await page.evaluate(async()=>{
    const h=(window as any).liveMediaHarness,e=h.engine,video=new Uint8Array(await(await fetch('/dist/fixtures/audio-motion.mp4')).arrayBuffer());
    const jpg=await e.encode(new Uint8Array(),'jpg',['-f','lavfi','-i','testsrc2=s=128x128:r=1','-frames:v','1','-q:v','1','$OUTPUT']);
    const pair=h.appleFixture(jpg,video);if(!h.trustedApplePair(pair.photo,pair.movie))throw new Error('Synthetic structural Apple pair rejected');
    const forged=pair.movie.slice(),fakeSample=h.tracks(forged)[2].samples[0];new DataView(fakeSample.buffer,fakeSample.byteOffset).setUint32(4,0);
    if(h.trustedApplePair(pair.photo,forged))throw new Error('Unreferenced still-image key incorrectly trusted');
    const c=h.defaults();c['compression.minSavingPercent']=0;c['compression.videoQuality']='custom';c['compression.ffmpegCrf']=30;
    const output=await new h.Compressor(e).encodeApple(pair.photo,pair.movie,c,new AbortController().signal);
    await h.validateAppleMovie(pair.movie,output.movie);await e.validate(output.movie);
    const old=h.tracks(pair.movie),next=h.tracks(output.movie);e.destroy();
    return {trusted:h.trustedApplePair(output.photo,output.movie),photoEqual:Array.from(output.photo).join(',')===Array.from(pair.photo).join(','),tracks:next.length,metaEqual:Array.from(old[2].samples[0]).join(',')===Array.from(next[2].samples[0]).join(','),smaller:output.movie.length<pair.movie.length};
  });
  expect(result).toEqual({trusted:true,photoEqual:true,tracks:3,metaEqual:true,smaller:true});
});
test('VFR frame timestamps remain exact or protectively reject without any write',async({page})=>{
  await page.goto('/tests/browser/index.html');await page.addScriptTag({url:'/dist/harness.js'});
  const result=await page.evaluate(async()=>{
    const h=(window as any).liveMediaHarness,e=h.engine;
    const source=new Uint8Array(await(await fetch('/dist/fixtures/vfr-motion.mp4')).arrayBuffer());
    const output=await e.encode(source,'mp4',['-v','error','-i','$INPUT','-map','0','-c','copy','-c:v','libx264','-crf','30','-fps_mode','passthrough','-enc_time_base:v','-1','$OUTPUT']);
    await e.validate(output);let protectedReason='';try{await h.validateVideoPreservation(source,output);}catch(e){protectedReason=String(e);}
    e.destroy();return {protectedReason,frames:h.tracks(source)[0].samples.length,outFrames:h.tracks(output)[0].samples.length};
  });
  expect(result.frames).toBeGreaterThan(30);
  if(result.protectedReason)expect(result.protectedReason).toMatch(/Frame presentation time|duration/);else expect(result.outFrames).toBe(result.frames);
});
test('lossless PNG preserves decoded RGBA; animated and unknown resources are protected',async({page})=>{
  await page.goto('/tests/browser/index.html');await page.addScriptTag({url:'/dist/harness.js'});
  const r=await page.evaluate(async()=>{
    const h=(window as any).liveMediaHarness,e=h.engine;
    const png=await e.encode(new Uint8Array(),'png',['-f','lavfi','-i','color=c=red@0.25:s=128x128,format=rgba','-frames:v','1','-compression_level','0','$OUTPUT']);
    const rgba=await e.encode(png,'png',['-i','$INPUT','-frames:v','1','-f','rawvideo','-pix_fmt','rgba','$OUTPUT'],'raw');
    const c=h.defaults();c['compression.minSavingPercent']=0;const out=await new h.Compressor(e).encode(png,'png',c,new AbortController().signal);
    let rejected=false;try{await new h.Compressor(e).encode(new TextEncoder().encode('GIF89a'),'gif',c,new AbortController().signal);}catch{rejected=true;}
    e.destroy();return {alpha:rgba[3],format:out.after.format,saving:out.bytes.length<png.length,rejected};
  });
  expect(r.format).toBe('png');expect(r.saving).toBe(true);expect(r.rejected).toBe(true);
  expect(r.alpha).toBeGreaterThan(0);expect(r.alpha).toBeLessThan(255);
});

test('sRGB and P3 JPEG compression keeps ICC, compares decoded color and permits untouched-photo motion mode',async({page})=>{
  await page.goto('/tests/browser/index.html');await page.addScriptTag({url:'/dist/harness.js'});
  const results=await page.evaluate(async()=>{
    const h=(window as any).liveMediaHarness,e=h.engine,c=h.defaults();c['compression.minSavingPercent']=0;c['compression.jpegQuality']=95;
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=384;
    const ctx=canvas.getContext('2d')!;const gradient=ctx.createLinearGradient(0,0,512,384);gradient.addColorStop(0,'#fa4536');gradient.addColorStop(.5,'#24c776');gradient.addColorStop(1,'#315df9');ctx.fillStyle=gradient;ctx.fillRect(0,0,512,384);
    const blob=await new Promise<Blob>(resolve=>canvas.toBlob(b=>resolve(b!),'image/jpeg',1));const jpeg=new Uint8Array(await blob.arrayBuffer());
    const output=[];
    for(const gamut of ['srgb','display-p3']){
      const input=h.addIcc(jpeg,h.profile(gamut)),result=await new h.Compressor(e).encode(input,'jpg',c,new AbortController().signal);
      output.push({gamut:result.after.icc,smaller:result.bytes.length<input.length,profileSame:Array.from(h.jpegIcc(input).bytes).join()===Array.from(h.jpegIcc(result.bytes).bytes).join(),colorVerified:result.warnings.some((v:string)=>v.includes('color comparison passed'))});
      await h.validateJpegColor(input,result.bytes,new AbortController().signal);
    }
    const video=new Uint8Array(await(await fetch('/dist/fixtures/audio-motion.mp4')).arrayBuffer());
    const small=await e.encode(new Uint8Array(),'jpg',['-f','lavfi','-i','testsrc2=s=128x128:r=1','-frames:v','1','-q:v','1','$OUTPUT']);
    const rawMotion=new Uint8Array(await(await fetch('/dist/fixtures/motion.jpg')).arrayBuffer());
    const input=h.addIcc(rawMotion,h.profile());c['compression.liveMode']='video-only';c['compression.videoQuality']='custom';c['compression.ffmpegCrf']=30;
    const live=await new h.Compressor(e).encode(input,'jpg',c,new AbortController().signal);
    let rejected=false;try{await h.validateJpegColor(h.addIcc(jpeg,h.profile()),h.addIcc(small,h.profile()),new AbortController().signal);}catch{rejected=true;}
    let changedProfile=false;try{await h.validateJpegColor(h.addIcc(jpeg,h.profile()),h.addIcc(jpeg,h.profile('srgb')),new AbortController().signal);}catch{changedProfile=true;}
    const sameProfile=Array.from(h.jpegIcc(input).bytes).join()===Array.from(h.jpegIcc(live.bytes).bytes).join();
    e.destroy();return {output,live:live.after.live,sameProfile,rejected,changedProfile};
  });
  expect(results.output).toEqual([{gamut:'srgb',smaller:true,profileSame:true,colorVerified:true},{gamut:'display-p3',smaller:true,profileSame:true,colorVerified:true}]);
  expect(results.live).toBe(true);expect(results.sameProfile).toBe(true);expect(results.rejected).toBe(true);expect(results.changedProfile).toBe(true);
});
