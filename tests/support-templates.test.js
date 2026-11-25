import test from "node:test";
import assert from "node:assert/strict";
import { getSupportTemplates, saveSupportTemplates } from "../app/services/supportTemplates.server.js";
const memory = () => { const rows = new Map(); return { customerRequest: {
  findUnique: async ({where}) => rows.get(where.requestKey) || null,
  upsert: async ({where, create, update}) => { const row=rows.has(where.requestKey) ? {...rows.get(where.requestKey),...update} : create; rows.set(where.requestKey,row); return row; }
}}; };
test('templates persist edits, additions and deletions independently for each shop', async () => {
 const db=memory(), shop='a.myshopify.com', other='b.myshopify.com';
 const defaults=await getSupportTemplates({db,shop}); assert.ok(defaults.length);
 await saveSupportTemplates({db,shop,templates:[{label:' 배송 안내 ',value:' 배송을 확인했습니다. '}]});
 assert.deepEqual(await getSupportTemplates({db,shop}),[{label:'배송 안내',value:'배송을 확인했습니다.'}]);
 assert.deepEqual(await getSupportTemplates({db,shop:other}),defaults);
 await saveSupportTemplates({db,shop,templates:[]}); assert.deepEqual(await getSupportTemplates({db,shop}),[]);
});
test('invalid templates cannot overwrite saved templates', async () => {
 const db=memory(), shop='a.myshopify.com', templates=[{label:'문의',value:'확인 중입니다.'}];
 await saveSupportTemplates({db,shop,templates});
 for (const bad of [[{label:'',value:'content'}], [{label:'ok',value:'x'.repeat(4001)}], new Array(31).fill(templates[0]), {}]) await assert.rejects(saveSupportTemplates({db,shop,templates:bad}), {status:400});
 assert.deepEqual(await getSupportTemplates({db,shop}),templates);
});
