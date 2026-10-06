// SPDX-License-Identifier: GPL-3.0-only
import {assets} from 'virtual:codec-assets';

async function unpack(encoded: string): Promise<ArrayBuffer> {
  if (typeof DecompressionStream === 'undefined') throw new Error('This WebView has no offline decompression support');
  const binary = atob(encoded);
  const compressed = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
export class OfflineEngine {
  private worker?: Worker;
  private ready?: Promise<void>;
  private id = 0;
  private urls: string[] = [];
  private pending = new Map<number, {resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout>}>();
  private epoch = 0;
  async load(): Promise<void> {
    if (this.ready) return this.ready;
    const epoch = this.epoch;
    this.ready = (async () => {
      const [workerCode, core, wasm, hdrCode, hdrWasm] = await Promise.all(
        ['worker','core','wasm','hdr','hdrWasm'].map(k => unpack(assets[k as keyof typeof assets])));
      if (epoch !== this.epoch) throw new Error('Engine load cancelled');
      const url = (b: ArrayBuffer) => {const u = URL.createObjectURL(new Blob([b], {type: 'text/javascript'})); this.urls.push(u); return u;};
      this.worker = new Worker(url(workerCode!));
      this.worker.onmessage = ({data}: MessageEvent<{id: number; result?: unknown; error?: string; discard?: boolean}>) => {
        const task = this.pending.get(data.id);
        if (!task) return;
        clearTimeout(task.timer); this.pending.delete(data.id);
        if (data.error) {const error=new Error(data.error);task.reject(error);if(data.discard)this.destroy(error);} else task.resolve(data.result);
      };
      this.worker.onerror = () => this.destroy(new Error('Offline worker failed'));
      await this.request('load', {coreURL: url(core!), wasm, hdrURL: url(hdrCode!), hdrWasm});
    })().catch(e => {if(this.epoch===epoch)this.destroy(); throw e;});
    return this.ready;
  }
  private request(op: string, data: Record<string, unknown>): Promise<unknown> {
    if (!this.worker) return Promise.reject(new Error('Worker unavailable'));
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.destroy(new Error('Encoding timeout')), 180000);
      this.pending.set(id, {resolve, reject, timer});
      try{this.worker!.postMessage({id, op, data});}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error instanceof Error?error:new Error('Worker transfer failed'));}
    });
  }
  async run(op: string, data: Record<string, unknown>): Promise<unknown> {await this.load(); return this.request(op, data);}
  async encode(input: Uint8Array, extension: string, args: string[], outputExtension = extension): Promise<Uint8Array> {
    return await this.run('execute', {input, extension, args, outputExtension}) as Uint8Array;
  }
  async validate(input: Uint8Array): Promise<void> {await this.run('validate', {input});}
  destroy(reason = new Error('Cancelled')): void {
    this.epoch++; this.worker?.terminate(); this.worker = undefined; this.ready = undefined;
    for (const task of this.pending.values()) {clearTimeout(task.timer); task.reject(reason);}
    this.pending.clear();
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls = [];
  }
}
