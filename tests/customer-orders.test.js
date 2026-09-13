import test from 'node:test';
import assert from 'node:assert/strict';
import { getCustomerOrders, CUSTOMER_ORDERS_QUERY } from '../app/services/customerOrders.server.js';
const shop='test.myshopify.com';
const request=new Request('https://example.com/api/customer/v1/orders?customerId=other&shop=other');
const order={ id:'gid://shopify/Order/123', name:'#123', processedAt:'2026-09-12T00:00:00Z', financialStatus:'PENDING', fulfillmentStatus:'UNFULFILLED', totalPrice:{amount:'15.00',currencyCode:'EUR'},subtotal:{amount:'10.00'},totalShipping:{amount:'5.00'},totalRefunded:{amount:'0'},totalTax:{amount:'1.00'},statusPageUrl:'https://example.com/status',lineItems:{nodes:[{id:'line',name:'Rice',quantity:2,price:{amount:'5.00'},variantId:'gid://shopify/ProductVariant/1'}],pageInfo:{hasNextPage:false,endCursor:null}} };
test('orders use the authenticated customer query and join only that customer’s shop-scoped IDs',async()=>{
 const result=await getCustomerOrders({request,shop,customerQuery:async(req,domain,query,variables)=>{
  assert.equal(req,request);assert.equal(domain,shop);assert.equal(query,CUSTOMER_ORDERS_QUERY);assert.deepEqual(variables,{first:10,after:null});
  return {id:'gid://shopify/Customer/1',orders:{nodes:[order],pageInfo:{hasNextPage:false,endCursor:null}}};
 },db:{inspectionRecord:{findMany:async(args)=>{
  assert.deepEqual(args.where,{shop,orderId:{in:[order.id,'123']}});
  return [{orderId:'123',status:'SUCCESS',_count:{items:1},updatedAt:'2026-09-12',inspectorName:'private'}];
 }}}});
 assert.equal(result.orders[0].inspectionStatus,'CHECKED');assert.equal(result.orders[0].subtotalPrice,10);assert.equal(result.orders[0].financialStatus,'PENDING');assert.equal(result.orders[0].lineItems[0].title,'Rice');assert.equal(JSON.stringify(result).includes('private'),false);
});
test('failed authentication never reads inspection records and empty orders remain distinct from errors',async()=>{
 const db={inspectionRecord:{findMany:()=>assert.fail('database must not be touched')}};
 await assert.rejects(getCustomerOrders({request,shop,db,customerQuery:async()=>{throw Object.assign(new Error(),{status:401});}}),{status:401});
 const empty=await getCustomerOrders({request,shop,db,customerQuery:async()=>({orders:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}}})});
 assert.deepEqual(empty.orders,[]);
 await assert.rejects(getCustomerOrders({request,shop,db,customerQuery:async()=>({})}),{status:502});
});
test('oversized orders pages fail before upstream calls',async()=>{
 await assert.rejects(getCustomerOrders({request:new Request('https://example.com/?limit=21'),shop,customerQuery:()=>assert.fail()}),{status:400});
});

test('order item pages require an exact match inside the authenticated customer’s orders',async()=>{
 const {getCustomerOrderItems}=await import('../app/services/customerOrders.server.js');
 const request=new Request('https://example.com/?orderId=123&cursor=next&limit=50');
 const customerQuery=async(_request,_shop,_query,variables)=>{
  assert.deepEqual(variables,{search:'id:123',first:50,after:'next'});
  return {orders:{nodes:[order]}};
 };
 const result=await getCustomerOrderItems({request,shop,customerQuery});assert.equal(result.lineItems[0].title,'Rice');
 await assert.rejects(getCustomerOrderItems({request,shop,customerQuery:async()=>({orders:{nodes:[{...order,id:'gid://shopify/Order/999'}]}})}),{status:404});
});

test('historical inspection uses customer-owned orders without requiring Admin order access',async()=>{
 const {getCustomerInspection}=await import('../app/services/customerInspection.server.js');
 const request=new Request('https://example.com/?orderId=123');let reads=0;
 const db={inspectionRecord:{findFirst:async()=>{reads++;return null;}}};
 const result=await getCustomerInspection({request,shop,db,graphql:()=>assert.fail('must not use admin'),customerQuery:async()=>({id:'gid://shopify/Customer/1',orders:{nodes:[{id:order.id,displayFulfillmentStatus:'FULFILLED'}]}})});
 assert.equal(result.status,'PREPARING');assert.equal(reads,1);
 await assert.rejects(getCustomerInspection({request,shop,db,customerQuery:async()=>({id:'gid://shopify/Customer/1',orders:{nodes:[]}})}),{status:404});
 assert.equal(reads,1);
});
