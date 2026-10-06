// Runtime acceptance only: consume a downloaded Actions harness, never compile here.
// Private input/output stay local. Do not add private files to Git or CI artifacts.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const [artifact,manifestPath,output,browserExecutable,playwrightDir,mode='serial']=process.argv.slice(2);
if(!artifact||!manifestPath||!output||!browserExecutable||!playwrightDir)throw new Error('Usage: artifact manifest output browser playwright [serial|isolated|baseline]');
const {chromium}=require(playwrightDir);
const proof=JSON.parse(fs.readFileSync(path.join(artifact,'provenance.json'))),input=JSON.parse(fs.readFileSync(manifestPath));
const harness=fs.readFileSync(path.join(artifact,'harness.js'));
if(crypto.createHash('sha256').update(harness).digest('hex')!==proof.files['harness.js'].sha256)throw new Error('Artifact harness fingerprint mismatch');
fs.mkdirSync(output,{recursive:true});const journal=path.join(output,'results.ndjson');
if(fs.existsSync(journal))throw new Error('Results already exist: use a fresh output directory');
const token=crypto.randomBytes(16).toString('hex'),items=input.photos,privateRoot=path.resolve(input.testCopies);
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1');if(url.searchParams.get('token')!==token){res.writeHead(403).end();return;}
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><title>Local private runtime verification</title>');return;}
  if(url.pathname==='/harness.js'){res.setHeader('Content-Type','text/javascript');res.end(harness);return;}
  const index=Number(url.searchParams.get('index'));
  if(!Number.isInteger(index)||index<0||index>=items.length){res.writeHead(400).end();return;}
  const entry=items[index];
  if(url.pathname==='/photo'&&req.method==='GET'){
    const f=path.resolve(privateRoot,entry.relative);if(!f.startsWith(privateRoot+path.sep))throw new Error('Input path escaped');
    const b=fs.readFileSync(f);if(crypto.createHash('sha256').update(b).digest('hex')!==entry.sha256)throw new Error('Input changed');
    res.setHeader('Content-Type','application/octet-stream');res.end(b);return;
  }
  if(url.pathname==='/output'&&req.method==='POST'){
    const chunks=[];let size=0;for await(const b of req){size+=b.length;if(size>128*1048576)throw new Error('Output budget');chunks.push(b);}
    const b=Buffer.concat(chunks),name=String(index).padStart(3,'0')+'-compressed'+path.extname(entry.relative);
    const f=path.join(output,name);fs.writeFileSync(f,b,{flag:'wx'});res.end(JSON.stringify({file:name,bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex')}));return;
  }
  res.writeHead(404).end();
 }catch(e){res.writeHead(500).end(String(e));}
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port,addr=pathname=>base+pathname+'?token='+token;
 const browser=await chromium.launch({executablePath:browserExecutable,headless:true,args:['--disable-background-networking','--disable-component-update','--no-first-run']});
 try{
  const page=await browser.newPage();page.setDefaultTimeout(180000);
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto(addr('/'));await page.addScriptTag({url:addr('/harness.js')});
  await page.exposeFunction('traceMedia',info=>fs.appendFileSync(path.join(output,'stages.ndjson'),JSON.stringify({at:new Date().toISOString(),...info})+'\n'));
  await page.evaluate(()=>{const e=window.liveMediaHarness.engine,run=e.run.bind(e);e.run=async(op,data)=>{await window.traceMedia({index:window.photoIndex,op,state:'start'});try{const r=await run(op,data);await window.traceMedia({index:window.photoIndex,op,state:'done'});return r;}catch(error){await window.traceMedia({index:window.photoIndex,op,state:'failed',reason:String(error).slice(0,240)});throw error;}};});
  if(process.env.PRIVATE_THREADS==='1')await page.evaluate(()=>{const e=window.liveMediaHarness.engine,encode=e.encode.bind(e);e.encode=(b,x,args,out)=>encode(b,x,['-threads','1','-filter_threads','1',...args.slice(0,-1),'-threads','1',args[args.length-1]],out);});
  const started=new Date();let passed=0,skipped=0,failed=0;
  for(let index=0;index<items.length;index++){
   if(process.env.PRIVATE_ONLY&&!process.env.PRIVATE_ONLY.split(',').map(Number).includes(index))continue;
   const result=await page.evaluate(async({base,token,index,mode})=>{
    window.photoIndex=index;const h=window.liveMediaHarness,e=h.engine,c=h.defaults();
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);
    const started=performance.now();let input,p;
    try{
      input=new Uint8Array(await(await fetch(base+'/photo?token='+token+'&index='+index)).arrayBuffer());p=h.probe(input);
      if(mode==='isolated')e.destroy();
      const encoded=await new h.Compressor(e).encode(input,'jpg',c,controller.signal);
      const saved=await(await fetch(base+'/output?token='+token+'&index='+index,{method:'POST',body:encoded.bytes})).json();
      return {state:'passed',inputBytes:input.length,outputBytes:encoded.bytes.length,savingPercent:(1-encoded.bytes.length/input.length)*100,live:p.live,hdr:p.hdr,width:p.width,height:p.height,icc:p.icc,warnings:encoded.warnings,output:saved,milliseconds:Math.round(performance.now()-started)};
    }catch(error){
      const reason=String(error),protectedResult=error.constructor?.name==='ProtectedMedia';
      return {state:protectedResult?'skipped':'failed',reason,live:p?.live,hdr:p?.hdr,width:p?.width,height:p?.height,icc:p?.icc,inputBytes:input?.length,milliseconds:Math.round(performance.now()-started)};
    }finally{clearTimeout(timer);if(mode==='isolated')e.destroy();}
   },{base,token,index,mode});
   const row={index,relative:items[index].relative,inputSha256:items[index].sha256,...result};fs.appendFileSync(journal,JSON.stringify(row)+'\n');
   if(result.state==='passed')passed++;else if(result.state==='skipped')skipped++;else failed++;
   console.log(JSON.stringify({processed:index+1,total:items.length,passed,skipped,failed,last:result.state,ms:result.milliseconds,reason:result.reason?.slice(0,160)}));
   if(mode==='baseline'&&failed>=3){console.log('Baseline stopped after three runtime failures; copied inputs remain intact.');break;}
  }
  await page.evaluate(()=>window.liveMediaHarness.engine.destroy());
  const summary={artifact:proof.commit,runId:proof.runId,browser:await browser.version(),mode,started:started.toISOString(),finished:new Date().toISOString(),passed,skipped,failed,total:items.length,privacy:'private runtime acceptance on copies; not CI and not Obsidian UI acceptance'};
  fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
