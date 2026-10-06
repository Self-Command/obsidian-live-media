// SPDX-License-Identifier: GPL-3.0-only
// A small protocol around the published FFmpeg Emscripten core; no host plugin code.
interface Core {
  FS: { writeFile(p: string, b: Uint8Array): void; readFile(p: string): Uint8Array; unlink(p: string): void };
  exec(...args: string[]): void;
  ffprobe(...args: string[]): void;
  ret: number;
  reset(): void;
  setTimeout(ms: number): void;
  setLogger(fn: (e: {message: string}) => void): void;
}
interface HdrCore {
  HEAPU8: Uint8Array;
  _malloc(n: number): number;
  _free(p: number): void;
  _lm_probe(p: number, n: number): number;
  _lm_reencode(p: number, n: number, q: number): number;
  _lm_output_size(): number;
  _lm_fixture(): number;
  _lm_error(): number;
  _lm_compare(a:number,an:number,b:number,bn:number):number;
}
const scope = self as unknown as {
  importScripts(...urls: string[]): void;
  createFFmpegCore(options: object): Promise<Core>;
  createUltraHDR(options: object): Promise<HdrCore>;
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(value: unknown, transfer?: Transferable[]): void;
};
let core: Core | undefined;
let hdr: HdrCore | undefined;
let initialized = false;
let tail = '';
scope.onmessage = async (event) => {
  const {id, op, data} = event.data as {id: number; op: string; data: Record<string, unknown>};
  try {
    let result: unknown;
    if (op === 'load') {
      if (initialized) throw new Error('Engine already loaded');
      scope.importScripts(data.coreURL as string, data.hdrURL as string);
      const locator = btoa(JSON.stringify({wasmURL: 'data:application/wasm;base64,', workerURL: 'data:text/javascript,'}));
      core = await scope.createFFmpegCore({wasmBinary: data.wasm, mainScriptUrlOrBlob: String(data.coreURL) + '#' + locator});
      core.setLogger(e => {tail=(tail+'\n'+e.message).slice(-2048);});
      hdr = await scope.createUltraHDR({wasmBinary: data.hdrWasm, noInitialRun: true});
      initialized = true;
      result = {ffmpeg: true, ultrahdr: true};
    } else {
      if (!core || !hdr) throw new Error('Engine not loaded');
      if (op === 'execute') {
        tail='';
        const input = data.input as Uint8Array;
        const ext = String(data.extension);
        if (!/^[a-z0-9]{1,5}$/.test(ext)) throw new Error('Invalid extension');
        const inFile = 'input.' + ext;
        const outFile = 'output.' + String(data.outputExtension ?? ext);
        core.FS.writeFile(inFile, input);
        try {
          const args = (data.args as string[]).map(a => a === '$INPUT' ? inFile : a === '$OUTPUT' ? outFile : a);
          core.setTimeout(120000);
          core.exec(...args);
          if (core.ret !== 0) throw new Error('FFmpeg exit ' + core.ret + ': '+tail);
          core.reset();
          result = core.FS.readFile(outFile).slice();
        } finally {
          for (const f of [inFile, outFile]) {try {core.FS.unlink(f);} catch { /* no partial output */ }}
          core.reset();
        }
      } else if (op === 'validate') {
        const input=data.input as Uint8Array;
        const ext=input[0]===137?'png':input[0]===255?'jpg':input[0]===82?'webp':'mp4';
        const file='verify.'+ext;tail='';core.FS.writeFile(file,input);
        try {
          core.setTimeout(120000);
          core.exec('-v', 'error', '-i', file, '-map', '0:v:0', '-map', '0:a?', '-c:v', 'rawvideo', '-c:a', 'pcm_s16le', '-f', 'null', '-');
          if (core.ret !== 0) throw new Error('Full video/image decode failed: '+tail);
          result = true;
        } finally {core.reset(); core.FS.unlink(file);}
      } else if (op === 'hdr-probe' || op === 'hdr-reencode') {
        const b = data.input as Uint8Array;
        const p = hdr._malloc(b.length);
        if (!p) throw new Error('HDR allocation failed');
        try {
          hdr.HEAPU8.set(b, p);
          if (op === 'hdr-probe') result = hdr._lm_probe(p, b.length);
          else {
            const output = hdr._lm_reencode(p, b.length, data.quality as number);
            if (!output) {const start=hdr._lm_error();let end=start;while(hdr.HEAPU8[end]&&end<start+256)end++;throw new Error('HDR intent reconstruction failed: '+new TextDecoder().decode(hdr.HEAPU8.subarray(start,end)));}
            result = hdr.HEAPU8.slice(output, output + hdr._lm_output_size());
          }
        } finally {hdr._free(p);}
      } else if(op==='hdr-compare'){
        const a=data.before as Uint8Array,b=data.after as Uint8Array;
        const ap=hdr._malloc(a.length),bp=hdr._malloc(b.length);
        try{if(!ap||!bp)throw new Error('HDR comparison allocation failed');hdr.HEAPU8.set(a,ap);hdr.HEAPU8.set(b,bp);result=hdr._lm_compare(ap,a.length,bp,b.length);}
        finally{if(ap)hdr._free(ap);if(bp)hdr._free(bp);}
      } else if (op === 'hdr-fixture') {
        const p = hdr._lm_fixture();
        if (!p) throw new Error('HDR synthetic fixture generation failed');
        result = hdr.HEAPU8.slice(p, p + hdr._lm_output_size());
      } else throw new Error('Unknown engine operation');
    }
    scope.postMessage({id, result}, result instanceof Uint8Array ? [result.buffer as ArrayBuffer] : []);
  } catch (error) {scope.postMessage({id, error: op + ': ' + String(error) + (error instanceof Error ? '\n' + error.stack : '')});}
};
