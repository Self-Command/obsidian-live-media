import {it,expect,vi} from 'vitest';
vi.mock('virtual:codec-assets',()=>({assets:{}}));
import {NativeEngine} from '../../src/engine/native';
it('native backend requires local authorization and uses explicit executable plus argv',async()=>{
  const denied=new NativeEngine('/usr/bin/ffmpeg',()=>false);await expect(denied.load()).rejects.toThrow('not authorized');
  const engine=new NativeEngine('/usr/bin/ffmpeg',()=>true);
  const jpg=await engine.encode(new Uint8Array(),'jpg',['-v','error','-f','lavfi','-i','color=blue:s=128x128','-frames:v','1','$OUTPUT']);
  expect(jpg[0]).toBe(255);expect(jpg[1]).toBe(216);
  await engine.validate(jpg);engine.destroy();
});
