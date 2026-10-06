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
    return {colorError,valid, validAfter, hdrBytes: hdr.length, compressedBytes: compressed.length, pngBytes: png.length, cancelled};
  });
  expect(result.valid).toBe(1); expect(result.validAfter).toBe(1);
  expect(result.pngBytes).toBeGreaterThan(50); expect(result.cancelled).toBe(true);
  expect(result.colorError).toBeGreaterThanOrEqual(0);expect(result.colorError).toBeLessThanOrEqual(.1);
});
