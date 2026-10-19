import test from "node:test";
import assert from "node:assert/strict";
import { createLegacySubscriptionHandler } from "../app/services/legacySubscription.server.js";
import { MobileApiError } from "../app/services/mobileApi.server.js";
const shop="test.myshopify.com";
const env={CUSTOMER_API_SHOP:shop,CUSTOMER_API_ALLOWED_ORIGINS:"https://dawayo.de"};
const request=input=>new Request("https://example.com/api/back-in-stock/subscribe",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input)});
test("legacy subscribe ignores forged shop/product metadata and uses validated customer resolver",async()=>{
 let received;
 const handler=createLegacySubscriptionHandler({env,resolve:async args=>{received={...args,input:await args.request.json()};return {accepted:true};}});
 const response=await handler({request:request({variantId:"123",email:"x@example.com",sku:"FORGED",productTitle:"FORGED",shop:"other.myshopify.com"})});
 assert.equal(response.status,200);assert.equal(received.shop,shop);assert.deepEqual(received.input,{variantId:"gid://shopify/ProductVariant/123",email:"x@example.com"});
});
test("legacy unsubscribe requires customer authentication and uses only authenticated email",async()=>{
 const cancelled=[];
 const handler=createLegacySubscriptionHandler({env,customerQuery:async req=>{if(!req.headers.get("authorization"))throw new MobileApiError(401,"LOGIN_REQUIRED","Sign in");return {emailAddress:{emailAddress:"owner@example.com"}};},cancel:async input=>{cancelled.push(input);return {count:1};}});
 assert.equal((await handler({request:request({intent:"unsubscribe",variantId:"123",email:"victim@example.com"})})).status,401);
 const authenticated=request({intent:"unsubscribe",variantId:"123",email:"victim@example.com",subscriptionId:"victim-id"});authenticated.headers.set("authorization","Bearer verified");
 assert.equal((await handler({request:authenticated})).status,200);assert.deepEqual(cancelled,[{shop,email:"owner@example.com",variantId:"gid://shopify/ProductVariant/123"}]);
});
test("legacy API rejects unsupported channels, unsafe origins and oversized requests",async()=>{
 const handler=createLegacySubscriptionHandler({env,resolve:()=>assert.fail("must not resolve")});
 assert.equal((await handler({request:request({variantId:"123",email:"x@example.com",channel:"PUSH"})})).status,503);
 const blocked=request({variantId:"123"});blocked.headers.set("origin","https://evil.vercel.app");assert.equal((await handler({request:blocked})).status,403);
 assert.equal((await handler({request:request({variantId:"123",email:"x".repeat(5000)})})).status,413);
});
