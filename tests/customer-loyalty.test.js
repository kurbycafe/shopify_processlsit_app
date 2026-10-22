import test from 'node:test';
import assert from 'node:assert/strict';
import { createJoyLoyalty, JoyRequestError, LOYALTY_POLICY } from '../app/services/joyLoyalty.server.js';
import { rewardClaim, reviewReward, customerLoyalty } from '../app/services/customerLoyalty.server.js';
import { customerAttendance } from '../app/services/customerCommunity.server.js';
import { createCustomerResolver } from '../app/services/customerResources.server.js';
import { createCustomerHandler } from '../app/services/customerApi.server.js';
const shop='tenant.myshopify.com', customerId='gid://shopify/Customer/42', other='gid://shopify/Customer/43';
const env={CUSTOMER_API_SHOP:shop,JOY_APP_KEY:'test-app',JOY_SECRET_KEY:'test-secret',JOY_SHOP_ID:'joy-shop'};
const request=new Request('https://example.com/api/customer/v1/loyalty',{headers:{Authorization:'Bearer shopify-customer-token'}});
const ok=data=>Response.json({success:true,data});
function memory(){
 const rows=[];
 const matches=(r,w)=>Object.entries(w).every(([k,v])=> v && typeof v==='object' ? v.in ? v.in.includes(r[k]) : v.not!==undefined ? r[k]!==v.not : false : r[k]===v);
 const db={customerRequest:{
  upsert:async({where,create})=>{let row=rows.find(r=>r.requestKey===where.requestKey);if(!row){row={...structuredClone(create),id:`claim_${rows.length+1}`,createdAt:new Date(),updatedAt:new Date()};rows.push(row);}return structuredClone(row);},
  updateMany:async({where,data})=>{let count=0;for(const row of rows)if(matches(row,where)){Object.assign(row,structuredClone(data),{updatedAt:new Date()});count++;}return {count};},
  findFirst:async({where})=>structuredClone(rows.find(r=>matches(r,where))||null),
  findMany:async({where,take})=>structuredClone(rows.filter(r=>matches(r,where)).slice(0,take)),
 }};return {db,rows};
}
function provider(){const calls=[];return {calls,configured:()=>true,prepare:async()=>{},award:async x=>calls.push(x),reconcile:async()=>null,balance:async()=>({points:50,verified:true,source:'JOY',checkedAt:new Date().toISOString()})};}
const claim=(db,loyalty,extra={})=>({db,loyalty,shop,customerId,subject:'attendance:2026-10-21',points:50,reason:'ATTENDANCE',note:'Check-in',...extra});
const productId='gid://shopify/Product/7';
const review={id:'review_1',payload:{productId,comment:'Real review',image:null}};
const orders=(nodes,hasNextPage=false,endCursor=null,id=customerId)=>({id,orders:{nodes,pageInfo:{hasNextPage,endCursor}}});
const paid=(extra={})=>({id:'gid://shopify/Order/1',cancelledAt:null,financialStatus:'PAID',lineItems:{nodes:[{productId,quantity:1}],pageInfo:{hasNextPage:false,endCursor:null}},...extra});

test('existing merchant policy is daily 50, text 50 and photo 100 points',()=>assert.deepEqual(LOYALTY_POLICY,{attendance:50,textReview:50,photoReview:100}));
test('REST identity checks bind credentials to the expected Joy store and Shopify customer',async()=>{
 const paths=[];const loyalty=createJoyLoyalty({env,fetcher:async(url,options)=>{paths.push(url);assert.equal(options.headers['X-Joy-Loyalty-Secret-Key'],'test-secret');assert.equal(options.redirect,'error');return ok(url.endsWith('/whoami')?{id:'joy-shop',isInstalled:true}:{shopifyCustomerId:42,point:175,type:'member'});}});
 const balance=await loyalty.balance({shop,customerId});assert.equal(balance.points,175);assert.equal(balance.source,'JOY');assert.equal(balance.verified,true);assert.ok(paths[1].endsWith('/customers/external/42'));
 await assert.rejects(loyalty.balance({shop:'foreign.myshopify.com',customerId}),{status:503});assert.equal(paths.length,2);
 const wrong=createJoyLoyalty({env,fetcher:async()=>ok({id:'foreign-joy-shop',isInstalled:true})});await assert.rejects(wrong.prepare({shop,customerId}),{status:503});
});
test('native Shopify-token grant reads real Joy balance without putting a secret in the app',async()=>{
 let step=0;const loyalty=createJoyLoyalty({env:{CUSTOMER_API_SHOP:shop,JOY_SHOP_DOMAIN:shop},fetcher:async(url,options)=>{step++;if(step===1){assert.ok(url.endsWith('/auth/token'));assert.deepEqual(JSON.parse(options.body),{grant_type:'shopify_customer_token',shopDomain:shop,shopifyToken:'shopify-customer-token'});return ok({token:'joy-jwt'});}assert.equal(options.headers.Authorization,'Bearer joy-jwt');return ok({points:267});}});
 assert.equal((await loyalty.balance({shop,customerId,request})).points,267);assert.equal(loyalty.configured(),false);
});
test('missing credentials never dispatch awards and malformed/provider errors never become verified zero',async()=>{
 let calls=0;const loyalty=createJoyLoyalty({env:{CUSTOMER_API_SHOP:shop},fetcher:async()=>{calls++;throw Error('private upstream body');}});
 await assert.rejects(loyalty.prepare({shop,customerId}));assert.equal(calls,0);
 await assert.rejects(loyalty.balance({shop,customerId,request}),err=>err.code==='LOYALTY_UNAVAILABLE'&&!err.message.includes('private'));
 for(const point of [null,'500',-1,undefined]){const broken=createJoyLoyalty({env,fetcher:async url=>ok(url.endsWith('/whoami')?{id:'joy-shop',isInstalled:true}:{shopifyCustomerId:42,point})});await assert.rejects(broken.balance({shop,customerId}));}
});
test('documented REST award uses server amount, correlation note and no automatic retry',async()=>{
 const calls=[];const loyalty=createJoyLoyalty({env,fetcher:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return ok({});}});
 await loyalty.award({customerId,points:50,reference:'dawayo:receipt',reason:'ATTENDANCE',note:'Check-in'});
 assert.equal(calls.length,1);assert.ok(calls[0].url.endsWith('/transactions/points/award'));assert.deepEqual(calls[0].body,{shopifyCustomerId:'42',point:50,adminNote:'dawayo:receipt',reason:'ATTENDANCE',userNote:'Check-in'});
});
test('concurrent retries reserve a single durable claim and make exactly one award request',async()=>{
 const {db,rows}=memory(),loyalty=provider();const result=await Promise.all(Array.from({length:10},()=>rewardClaim(claim(db,loyalty))));assert.equal(loyalty.calls.length,1);assert.equal(rows.length,1);assert.ok(result.some(r=>r.status==='AWARDED'));
 const replay=await rewardClaim(claim(db,loyalty,{points:9999}));assert.equal(replay.points,50);assert.equal(loyalty.calls.length,1);
});
test('network uncertainty is durable and can never trigger a second award, even after a retry',async()=>{
 const {db,rows}=memory(),loyalty=provider();loyalty.award=async x=>{loyalty.calls.push(x);throw new JoyRequestError();};
 assert.equal((await rewardClaim(claim(db,loyalty))).status,'UNKNOWN');assert.equal(rows[0].status,'UNKNOWN');
 assert.equal((await rewardClaim(claim(db,loyalty))).status,'UNKNOWN');assert.equal(loyalty.calls.length,1);
 loyalty.reconcile=async()=>({transactionId:'joy-transaction'});assert.equal((await rewardClaim(claim(db,loyalty))).status,'AWARDED');assert.equal(rows[0].payload.transactionId,'joy-transaction');assert.equal(loyalty.calls.length,1);
});
test('explicit structured rejection is retryable; provider success followed by DB failure is reconcile-only',async()=>{
 const {db,rows}=memory(),loyalty=provider();let reject=true;loyalty.award=async x=>{loyalty.calls.push(x);if(reject)throw new JoyRequestError(true);};
 assert.equal((await rewardClaim(claim(db,loyalty))).status,'REJECTED');reject=false;
 const update=db.customerRequest.updateMany;db.customerRequest.updateMany=async args=>{if(args.data.status==='AWARDED')throw Error('DB ack lost');return update(args);};
 await assert.rejects(rewardClaim(claim(db,loyalty)),/DB ack lost/);assert.equal(rows[0].status,'SENDING');
 db.customerRequest.updateMany=update;rows[0].updatedAt=new Date(0);loyalty.reconcile=async()=>({transactionId:'confirmed'});
 assert.equal((await rewardClaim(claim(db,loyalty))).status,'AWARDED');assert.equal(loyalty.calls.length,2);
});
test('a missing provider keeps a durable retryable receipt without claiming points issuance',async()=>{
 const {db,rows}=memory(),loyalty=provider();loyalty.prepare=async()=>{throw Error('keys missing');};
 const result=await rewardClaim(claim(db,loyalty));assert.equal(result.status,'PENDING_CONFIGURATION');assert.equal(result.awardedPoints,0);assert.equal(rows[0].status,'READY');assert.equal(loyalty.calls.length,0);
});
test('attendance ignores caller date and points, deduplicates the Berlin day and awards the server policy',async()=>{
 const {db,rows}=memory(),loyalty=provider(),args={db,loyalty,shop,request,verify:async()=>customerId};
 const first=await customerAttendance({...args,input:{date:'1900-01-01',points:50000}});const second=await customerAttendance({...args,input:{}});
 assert.equal(first.id,second.id);assert.notEqual(first.date,'1900-01-01');assert.equal(first.reward.awardedPoints,50);assert.equal(loyalty.calls.length,1);assert.equal(rows.filter(r=>r.type==='ATTENDANCE').length,1);
});
test('review payout requires a verified paid purchase and is one award per customer and product',async()=>{
 const {db}=memory(),loyalty=provider(),args={db,loyalty,shop,customerId,request,customerQuery:async()=>orders([paid()]),review};
 assert.equal((await reviewReward(args)).awardedPoints,50);
 assert.equal((await reviewReward({...args,review:{...review,id:'second',payload:{...review.payload,image:'photo'}}})).points,50);assert.equal(loyalty.calls.length,1);
 const another=await reviewReward({...args,customerId:other,customerQuery:async()=>orders([paid()],false,null,other),review:{...review,payload:{...review.payload,image:'photo'}}});assert.equal(another.awardedPoints,100);assert.equal(loyalty.calls.length,2);
});
test('unpaid, cancelled, foreign, missing and unpurchased products cannot receive review points',async()=>{
 for(const list of [[paid({financialStatus:'PENDING'})],[paid({cancelledAt:'2026-01-01'})],[],[paid({lineItems:{nodes:[{productId:'gid://shopify/Product/8',quantity:1}],pageInfo:{hasNextPage:false}}})]]){
  const {db}=memory(),loyalty=provider();const reward=await reviewReward({db,loyalty,shop,customerId,request,customerQuery:async()=>orders(list),review});assert.equal(reward.status,'INELIGIBLE');assert.equal(loyalty.calls.length,0);
 }
 const {db}=memory(),loyalty=provider();assert.equal((await reviewReward({db,loyalty,shop,customerId,request,customerQuery:async()=>orders([paid()],false,null,other),review})).status,'PENDING_VERIFICATION');assert.equal(loyalty.calls.length,0);
});
test('purchase verification follows order and line-item continuation pages, with repeated cursors rejected',async()=>{
 const {db}=memory(),loyalty=provider();let calls=0;
 const customerQuery=async(_r,_s,q)=>{calls++;if(calls===1)return orders([],true,'order-next');if(q.includes('MobileReviewPurchaseItems'))return orders([paid()]);return orders([paid({lineItems:{nodes:[],pageInfo:{hasNextPage:true,endCursor:'item-next'}}})]);};
 assert.equal((await reviewReward({db,loyalty,shop,customerId,request,customerQuery,review})).status,'AWARDED');assert.equal(calls,3);
 const stuck=await reviewReward({db,loyalty,shop,customerId,request,customerQuery:async()=>orders([],true,'same'),review});assert.equal(stuck.status,'PENDING_VERIFICATION');assert.equal(loyalty.calls.length,1);
});
test('customer cannot retry another account or another shop claim and request amounts are ignored',async()=>{
 const {db}=memory(),loyalty=provider();const result=await rewardClaim(claim(db,loyalty));
 for(const args of [{customerId:other},{shop:'foreign.myshopify.com'}])await assert.rejects(customerLoyalty({db,loyalty,shop,customerId,request,...args,input:{claimId:result.id,points:50000}}),{status:404});
 const replay=await customerLoyalty({db,loyalty,shop,customerId,request,input:{claimId:result.id,points:50000}});assert.equal(replay.reward.points,50);assert.equal(loyalty.calls.length,1);
});
test('loyalty history remains available during balance outage and never substitutes a made-up zero',async()=>{
 const {db}=memory(),loyalty=provider();await rewardClaim(claim(db,loyalty));loyalty.balance=async()=>{throw Error('provider down');};
 const result=await customerLoyalty({db,loyalty,shop,customerId,request});assert.equal(result.points,null);assert.equal(result.verified,false);assert.equal(result.claims.length,1);assert.equal(result.claims[0].status,'AWARDED');
});
test('loyalty GET and POST require verified authentication and allow the native CORS origin',async()=>{
 const {db}=memory(),loyalty=provider();const resolve=createCustomerResolver({db,loyalty,verify:async()=>{throw Object.assign(Error('expired'),{status:401});}});
 await assert.rejects(resolve({request,shop,resource:'loyalty'}),{status:401});
 const handler=createCustomerHandler(async()=>({ok:true}),{CUSTOMER_API_SHOP:shop,CUSTOMER_API_ALLOWED_ORIGINS:'capacitor://localhost'});
 const response=await handler({request:new Request(request.url,{method:'OPTIONS',headers:{Origin:'capacitor://localhost'}}),params:{resource:'loyalty'}});assert.equal(response.status,204);assert.match(response.headers.get('Access-Control-Allow-Methods'),/POST/);
});

test('provider reconciliation matches reference, amount and customer and follows real pagination',async()=>{
 let pages=0;const loyalty=createJoyLoyalty({env,fetcher:async url=>{
  if(url.endsWith('/whoami'))return ok({id:'joy-shop',isInstalled:true});
  if(url.includes('/customers/external/'))return ok({shopifyCustomerId:42,point:150,type:'member'});
  pages++;const parsed=new URL(url);assert.equal(parsed.searchParams.get('shopifyCustomerId'),'42');
  if(pages===1)return Response.json({success:true,data:[{id:'old',shopifyCustomerId:42,adminNote:'wrong',earnPoint:50}],meta:{pagination:{hasNext:true}}});
  assert.equal(parsed.searchParams.get('after'),'old');
  return Response.json({success:true,data:[{id:'foreign',shopifyCustomerId:43,adminNote:'dawayo:ref',earnPoint:50},{id:'wrong-amount',shopifyCustomerId:42,adminNote:'dawayo:ref',earnPoint:100},{id:'confirmed',shopifyCustomerId:42,adminNote:'dawayo:ref',earnPoint:50}],meta:{pagination:{hasNext:false}}});
 }});
 assert.deepEqual(await loyalty.reconcile({shop,customerId,reference:'dawayo:ref',points:50,createdAt:'2026-10-21T10:00:00Z'}),{transactionId:'confirmed'});assert.equal(pages,2);
});
test('read-only connection check validates the store and sends no award requests',async()=>{
 const urls=[];const loyalty=createJoyLoyalty({env,fetcher:async url=>{urls.push(url);return ok({id:'joy-shop',isInstalled:true});}});
 assert.equal((await loyalty.checkConnection({shop})).shopVerified,true);assert.equal(urls.length,1);assert.ok(urls[0].endsWith('/whoami'));
});
