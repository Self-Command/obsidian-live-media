import {test,expect} from '@playwright/test';
import {installModalHost} from './modal-host';
test('downloaded plugin goes from note scan through real encoding and review to copy commit when Modal owns boolean isOpen',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));await installModalHost(page,{actualCodec:true});
  await page.evaluate(()=>(window as any).modalAcceptance.start());await expect(page.locator('input[type=checkbox]:checked')).toHaveCount(3);
  await page.getByRole('button',{name:'下一步：准备临时结果'}).click();await expect(page.locator('h2')).toHaveText('3 · 对比并确认 / Review',{timeout:90000});
  const before=await page.evaluate(()=>{const t=(window as any).modalAcceptance;return {calls:t.entries.encodes.length,creates:t.entries.creates,unchanged:t.unchanged(),errors:t.entries.errors,isOpen:t.entries.modals.every((m:any)=>typeof m.isOpen==='boolean')};});
  expect(before).toEqual({calls:2,creates:[],unchanged:true,errors:[],isOpen:true});expect(errors).toEqual([]);
  await expect(page.locator('.live-media-pending')).toContainText('尚未保存');
  await expect(page.getByRole('button',{name:'确认保存压缩副本'})).toBeVisible();await expect(page.locator('input[type=checkbox]:checked')).toHaveCount(2);
  await page.getByRole('button',{name:'确认保存压缩副本'}).click();await expect(page.locator('h2')).toHaveText('4 · 保存与读回 / Commit');
  await expect(page.locator('.modal-host')).toContainText('media/live-compressed.jpg · 压缩副本已保存并读回校验通过',{timeout:30000});
  const after=await page.evaluate(()=>{const t=(window as any).modalAcceptance;return {creates:t.entries.creates,unchanged:t.unchanged(),errors:t.entries.errors};});
  await expect(page.locator('.live-media-save-summary')).toContainText('已保存并读回校验 2 / 2');
  expect(after).toEqual({creates:['media/first-compressed.jpg','media/live-compressed.jpg'],unchanged:true,errors:[]});expect(errors).toEqual([]);
  await page.evaluate(()=>(window as any).modalAcceptance.close());
});
test('visible per-photo progress can be cancelled without writes or reopening a completed modal',async({page})=>{
  await installModalHost(page,{hold:true});await page.evaluate(()=>(window as any).modalAcceptance.start());await expect(page.locator('input[type=checkbox]:checked')).toHaveCount(3);
  await page.getByRole('button',{name:'下一步：准备临时结果'}).click();await expect(page.locator('.live-media-progress-current')).toContainText('当前 1 / 3 · 压缩与校验 · media/first.jpg');
  await page.getByRole('button',{name:'取消',exact:true}).click();await expect(page.locator('.modal-host')).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>(window as any).modalAcceptance.plugin.batch.busy)).toBe(false);
  await expect(page.locator('.modal-host')).toHaveCount(0);
  const result=await page.evaluate(()=>{const t=(window as any).modalAcceptance;return {calls:t.entries.encodes.length,creates:t.entries.creates,cancelled:t.entries.cancelled,unchanged:t.unchanged(),errors:t.entries.errors};});
  expect(result).toEqual({calls:1,creates:[],cancelled:true,unchanged:true,errors:[]});await page.evaluate(()=>(window as any).modalAcceptance.close());
});
test('a review open failure keeps validated results and retries without reencoding any photo',async({page})=>{
  await installModalHost(page,{failReviewOnce:true});await page.evaluate(()=>(window as any).modalAcceptance.start());await expect(page.locator('input[type=checkbox]:checked')).toHaveCount(3);
  await page.getByRole('button',{name:'下一步：准备临时结果'}).click();await expect(page.getByRole('button',{name:'重试打开结果'})).toBeVisible();
  await expect(page.locator('.live-media-progress-summary')).toHaveText('已完成 3 / 3 · 临时结果 2（未保存） · 跳过 0 · 失败 1');
  await expect(page.locator('.live-media-progress-result')).toHaveCount(3);await expect(page.locator('[data-outcome=failed]')).toContainText('本张失败，继续下一张');
  await page.getByRole('button',{name:'重试打开结果'}).click();await expect(page.locator('h2')).toHaveText('3 · 对比并确认 / Review');
  const result=await page.evaluate(()=>{const t=(window as any).modalAcceptance;return {calls:t.entries.encodes.length,creates:t.entries.creates,unchanged:t.unchanged(),errors:t.entries.errors};});
  expect(result).toEqual({calls:2,creates:[],unchanged:true,errors:[]});await page.evaluate(()=>(window as any).modalAcceptance.close());
});

test('review makes original replacement explicit and closing without confirmation never saves temporary results',async({page})=>{
  await installModalHost(page);await page.evaluate(()=>(window as any).modalAcceptance.start());await expect(page.locator('input[type=checkbox]:checked')).toHaveCount(3);
  await expect(page.locator('.setting-item').filter({hasText:'保存方式'})).toContainText('替换原图保留路径和引用');
  await page.getByRole('button',{name:'下一步：准备临时结果'}).click();await expect(page.locator('h2')).toHaveText('3 · 对比并确认 / Review');
  await page.locator('select').selectOption('replace');await expect(page.getByRole('button',{name:'确认替换原图（先备份）'})).toBeVisible();
  await expect(page.locator('.live-media-output-explanation')).toContainText('压缩结果写回原路径');
  await page.evaluate(()=>(window as any).modalAcceptance.close());
  expect(await page.evaluate(()=>{const t=(window as any).modalAcceptance;return {creates:t.entries.creates,unchanged:t.unchanged()};})).toEqual({creates:[],unchanged:true});
});
