import {test,expect} from '@playwright/test';
import {installModalHost} from './modal-host';
test('downloaded plugin goes from note scan through real encoding and review to copy commit when Modal owns boolean isOpen',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));await installModalHost(page,{actualCodec:true});
  await page.evaluate(()=>(window as any).modalAcceptance.start());await expect(page.locator('input[type=checkbox]:checked')).toHaveCount(3);
  await page.getByRole('button',{name:'下一步：编码预览'}).click();await expect(page.locator('h2')).toHaveText('3 · 对比并确认 / Review',{timeout:90000});
  const before=await page.evaluate(()=>{const t=(window as any).modalAcceptance;return {calls:t.entries.encodes.length,creates:t.entries.creates,unchanged:t.unchanged(),errors:t.entries.errors,isOpen:t.entries.modals.every((m:any)=>typeof m.isOpen==='boolean')};});
  expect(before).toEqual({calls:3,creates:[],unchanged:true,errors:[],isOpen:true});expect(errors).toEqual([]);
  await expect(page.getByRole('button',{name:'保存已选结果'})).toBeVisible();await expect(page.locator('input[type=checkbox]:checked')).toHaveCount(2);
  await page.getByRole('button',{name:'保存已选结果'}).click();await expect(page.locator('h2')).toHaveText('4 · 保存与读回 / Commit');
  await expect(page.locator('.modal-host')).toContainText('media/live-compressed.jpg · committed',{timeout:30000});
  const after=await page.evaluate(()=>{const t=(window as any).modalAcceptance;return {creates:t.entries.creates,unchanged:t.unchanged(),errors:t.entries.errors};});
  expect(after).toEqual({creates:['media/first-compressed.jpg','media/live-compressed.jpg'],unchanged:true,errors:[]});expect(errors).toEqual([]);
  await page.evaluate(()=>(window as any).modalAcceptance.close());
});
test('visible per-photo progress can be cancelled without writes or reopening a completed modal',async({page})=>{
  await installModalHost(page,{hold:true});await page.evaluate(()=>(window as any).modalAcceptance.start());await expect(page.locator('input[type=checkbox]:checked')).toHaveCount(3);
  await page.getByRole('button',{name:'下一步：编码预览'}).click();await expect(page.locator('.live-media-progress-current')).toContainText('当前 1 / 3 · 压缩与校验 · media/first.jpg');
  await page.getByRole('button',{name:'取消',exact:true}).click();await expect(page.locator('.modal-host')).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>(window as any).modalAcceptance.plugin.batch.busy)).toBe(false);
  await expect(page.locator('.modal-host')).toHaveCount(0);
  const result=await page.evaluate(()=>{const t=(window as any).modalAcceptance;return {calls:t.entries.encodes.length,creates:t.entries.creates,cancelled:t.entries.cancelled,unchanged:t.unchanged(),errors:t.entries.errors};});
  expect(result).toEqual({calls:1,creates:[],cancelled:true,unchanged:true,errors:[]});await page.evaluate(()=>(window as any).modalAcceptance.close());
});
test('a review open failure keeps validated results and retries without reencoding any photo',async({page})=>{
  await installModalHost(page,{failReviewOnce:true});await page.evaluate(()=>(window as any).modalAcceptance.start());await expect(page.locator('input[type=checkbox]:checked')).toHaveCount(3);
  await page.getByRole('button',{name:'下一步：编码预览'}).click();await expect(page.getByRole('button',{name:'重试打开结果'})).toBeVisible();
  await expect(page.locator('.live-media-progress-summary')).toHaveText('已完成 3 / 3 · 成功 2 · 跳过 0 · 失败 1');
  await expect(page.locator('.live-media-progress-result')).toHaveCount(3);await expect(page.locator('[data-outcome=failed]')).toContainText('本张失败，继续下一张');
  await page.getByRole('button',{name:'重试打开结果'}).click();await expect(page.locator('h2')).toHaveText('3 · 对比并确认 / Review');
  const result=await page.evaluate(()=>{const t=(window as any).modalAcceptance;return {calls:t.entries.encodes.length,creates:t.entries.creates,unchanged:t.unchanged(),errors:t.entries.errors};});
  expect(result).toEqual({calls:3,creates:[],unchanged:true,errors:[]});await page.evaluate(()=>(window as any).modalAcceptance.close());
});
