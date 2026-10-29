import test from 'node:test';
import assert from 'node:assert/strict';
import {customerReferral} from '../app/services/customerReferral.server.js';

test('referral codes are account scoped, do not create on read, prevent self-referral and link only once', async()=>{
 const rows=[]; const db={customerRequest:{findFirst:async({where})=>rows.find(r=>r.shop===where.shop && (!where.customerId || r.customerId===where.customerId) && r.type===where.type && (!where.payload || r.payload.code===where.payload.equals)) || null,upsert:async({where,create})=>{let r=rows.find(x=>x.requestKey===where.requestKey);if(!r){r={...create,id:`id-${rows.length}`};rows.push(r);}return r;}}};
 const shop='shop.myshopify.com'; const request=new Request('https://example.com');
 const call=(id,input,tenant=shop)=>customerReferral({db,shop:tenant,request,verify:async()=>`gid://shopify/Customer/${id}`,input});
 assert.equal((await call(1)).code,null);assert.equal(rows.length,0);
 const a=await call(1,{create:true}), again=await call(1,{create:true});assert.equal(a.code,again.code);
 await assert.rejects(call(1,{code:a.code}),{status:400});
 await assert.rejects(call(2,{code:a.code},'other.myshopify.com'),{status:400});
 const linked=await call(2,{code:a.code});assert.equal(linked.accepted,true);assert.equal(linked.rewardsAvailable,false);
 assert.equal((await call(2)).hasReferrer,true);
 const b=await call(3,{create:true});await assert.rejects(call(2,{code:b.code}),{status:409});
});
