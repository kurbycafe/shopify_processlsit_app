import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomerHandler } from '../app/services/customerApi.server.js';
import { createCustomerResolver } from '../app/services/customerResources.server.js';

test('customer conversation HTTP endpoint accepts POST, rejects other customers, and does not expose internal notes', async () => {
 const row={id:'req1',shop:'demo.myshopify.com',customerId:'gid://shopify/Customer/1',type:'SUPPORT',status:'REVIEWING',updatedAt:new Date('2026-01-01T00:00:00Z'),payload:{message:'original',supportInternal:{note:'private'}}};
 const db={customerRequest:{findFirst:async ({where}) => where.id===row.id && where.shop===row.shop && where.customerId===row.customerId ? structuredClone(row) : null,updateMany:async ({where,data})=>{if(where.customerId!==row.customerId)return {count:0};Object.assign(row,data);row.updatedAt=new Date(row.updatedAt.getTime()+1);return {count:1};},findMany:async()=>[structuredClone(row)],count:async()=>0}};
 let verified='gid://shopify/Customer/2';
 const resolve=createCustomerResolver({db,verify:async()=>verified});
 const handler=createCustomerHandler(resolve,{CUSTOMER_API_SHOP:'demo.myshopify.com'});
 const post=()=>new Request('https://example.test/api/customer/v1/support-conversation',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:'req1',messageId:'msg-1',text:'hello'})});
 let response=await handler({request:post(),params:{resource:'support-conversation'}}); assert.equal(response.status,404);
 verified=row.customerId; response=await handler({request:post(),params:{resource:'support-conversation'}}); assert.equal(response.status,200); assert.equal((await response.json()).data.message.text,'hello');
 response=await handler({request:new Request('https://example.test/api/customer/v1/customer-requests'),params:{resource:'customer-requests'}});
 const body=await response.json(); assert.equal(body.data.requests[0].payload.supportInternal,undefined); assert.equal(body.data.requests[0].payload.conversation[0].text,'hello');
});
