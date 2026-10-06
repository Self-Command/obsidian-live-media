import {it,expect} from 'vitest';
import {profile,addIcc} from '../fixtures/icc';
import {jpegIcc} from '../../src/media/color';
import {probe} from '../../src/media/probe';
const jpeg=Uint8Array.of(255,216,255,217);
it.each(['srgb','display-p3']as const)('identifies generated %s matrix ICC without blanket protection',gamut=>{
  const b=addIcc(jpeg,profile(gamut));expect(jpegIcc(b)?.gamut).toBe(gamut);expect(probe(b).protected).toEqual([]);expect(probe(b).icc).toBe(gamut);
});
it('rejects truncated, repeated and unsupported ICC safely',()=>{
  const p=profile();new DataView(p.buffer).setUint32(0,12);expect(()=>jpegIcc(addIcc(jpeg,p))).toThrow('Invalid ICC header');
  expect(()=>jpegIcc(addIcc(addIcc(jpeg,profile()),profile()))).toThrow('Incomplete ICC profile');
  const unknown=profile();new DataView(unknown.buffer).setInt32(132+7*12+20+8,65536);expect(jpegIcc(addIcc(jpeg,unknown))?.gamut).toBeUndefined();
});
