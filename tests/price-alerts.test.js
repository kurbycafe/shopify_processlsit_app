import test from 'node:test';
import assert from 'node:assert/strict';
import {customerPriceAlerts,checkPriceAlerts} from '../app/services/priceAlerts.server.js';

test('price alerts require consent, use verified prices, send once, and unsubscribe safely',async()=>{
 const rows=[];let count=0,price='10.00', marketing=false;
 const shop='store.myshopify.com',customerId='gid://shopify/Customer/1',variantId='gid://shopify/ProductVariant/10',productId='gid://shopify/Product/20';
 const db={customerNotificationPreference:{findUnique:async()=>({pushEnabled:true,marketing})},customerRequest:{
  findUnique:async({where})=>rows.find(r=>r.requestKey===where.requestKey)||null,
  count:async({where})=>rows.filter(r=>r.shop===where.shop&&r.customerId===where.customerId&&r.type===where.type&&r.status===where.status).length,
  findMany:async({where})=>rows.filter(r=>r.shop===where.shop&&r.type===where.type&&(!where.customerId||r.customerId===where.customerId)&&r.status===where.status),
  findFirst:async({where})=>rows.find(r=>r.id===where.id&&r.shop===where.shop&&r.status===where.status&&r.updatedAt===where.updatedAt)||null,
  upsert:async({where,create,update})=>{let row=rows.find(r=>r.requestKey===where.requestKey);if(!row){row={...create,id:`row${++count}`,updatedAt:new Date(1000+count)};rows.push(row);}else Object.assign(row,update);return row;},
  updateMany:async({where,data})=>{const row=rows.find(r=>(!where.id||r.id===where.id)&&(!where.requestKey||r.requestKey===where.requestKey)&&r.shop===where.shop&&(!where.customerId||r.customerId===where.customerId)&&(!where.status||r.status===where.status)&&(!where.updatedAt||r.updatedAt===where.updatedAt));if(!row)return {count:0};Object.assign(row,data,{updatedAt:new Date(row.updatedAt.getTime()+1)});return {count:1};}
 }};
 const graphql=async()=>({data:{productVariant:{id:variantId,price,product:{id:productId,title:'Product',status:'ACTIVE',onlineStoreUrl:'https://store.example/product'}}}});
 const args={db,shop,request:new Request('https://example.com'),verify:async()=>customerId,graphql};
 await assert.rejects(customerPriceAlerts({...args,input:{action:'subscribe',variantId}}),{status:409});
 marketing=true;assert.equal((await customerPriceAlerts({...args,input:{action:'subscribe',variantId}})).accepted,true);
 assert.equal(rows.find(r=>r.type==='PRICE_ALERT').payload.baselineCents,1000);
 await checkPriceAlerts({...args});assert.equal(rows.filter(r=>r.type==='MOBILE_NOTIFICATION').length,0);
 price='8.50';await checkPriceAlerts({...args});
 const alert=rows.find(r=>r.type==='PRICE_ALERT');assert.equal(alert.status,'NOTIFIED');
 assert.equal(rows.filter(r=>r.type==='MOBILE_NOTIFICATION').length,1);
 await checkPriceAlerts({...args});assert.equal(rows.filter(r=>r.type==='MOBILE_NOTIFICATION').length,1);
 await customerPriceAlerts({...args,input:{action:'unsubscribe',variantId}});assert.equal(alert.status,'DISABLED');
});

