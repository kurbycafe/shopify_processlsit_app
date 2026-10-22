import test from 'node:test';
import assert from 'node:assert/strict';
import {createCustomerResolver} from '../app/services/customerResources.server.js';
import {createCustomerHandler} from '../app/services/customerApi.server.js';
import {customerCommunity,customerComments,customerReaction,customerRequestHistory,customerAttendance,customerDeleteRequest,reviewImage} from '../app/services/customerCommunity.server.js';
import {customerPhotoReviews} from '../app/services/customerRequests.server.js';
import {getStorefrontConfig} from '../app/services/mobileStorefront.server.js';
const shop='tenant.myshopify.com',customer='gid://shopify/Customer/1',other='gid://shopify/Customer/2';
const req=(body,path='')=>new Request(`https://example.com/${path}`,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
function memory(){
 const rows=[],reactions=[],writes=[];
 const matches=(row,where)=>Object.entries(where||{}).every(([key,value])=>{
  if(key==='payload')return row.payload?.[value.path[0]]===value.equals;
  if(value && typeof value==='object'){
   if(value.in)return value.in.includes(row[key]);if(value.not!==undefined)return row[key]!==value.not;if(value.lt)return row[key]<value.lt;
  }
  return row[key]===value;
 });
 const db={customerRequest:{
  upsert:async({where,create,update})=>{writes.push(create);let row=rows.find(item=>item.requestKey===where.requestKey);if(!row){row={id:`record_${rows.length+1}`,createdAt:new Date(),updatedAt:new Date(),status:'REQUESTED',...create};rows.push(row);}else Object.assign(row,update);return structuredClone(row);},
  findMany:async({where,take})=>rows.filter(row=>matches(row,where)).reverse().slice(0,take),
  findFirst:async({where})=>rows.find(row=>matches(row,where))||null,
  count:async({where})=>rows.filter(row=>matches(row,where)).length,
 },customerReaction:{
  upsert:async({create,update})=>{const row=reactions.find(item=>['shop','targetType','targetId','customerId'].every(key=>item[key]===create[key]));if(row)Object.assign(row,update);else reactions.push({...create});},
  groupBy:async({where})=>{const values=reactions.filter(row=>matches(row,where));return [...new Set(values.map(row=>row.targetId))].map(targetId=>({targetId,_count:{_all:values.filter(row=>row.targetId===targetId).length}}));},
 },mobileStorefrontConfig:{findFirst:async()=>null},mobileBanner:{findMany:async()=>[]},mobileHotDeal:{findMany:async()=>[]},mobileCategoryConfig:{findMany:async()=>[]}};
 return {db,rows,reactions,writes};
}
const args=db=>({db,shop,request:req(),verify:async()=>customer});
const postInput={title:'Actual recipe',content:'Submitted by a customer',author:'Customer nickname',tag:'recipes',recipeMeta:{ingredients:[{productId:'gid://shopify/Product/10',variantId:'gid://shopify/ProductVariant/20',price:0.01,stock:999}],steps:['Actual cooking step']}};
test('public configuration reads an empty database without inserting products, banners or policy claims',async()=>{
 const {db,writes}=memory();const result=await getStorefrontConfig(shop,{db});
 assert.deepEqual(result.banners,[]);assert.deepEqual(result.hotDeals,[]);assert.deepEqual(result.groupBuying,[]);assert.deepEqual(result.productOverrides,[]);assert.equal(result.store.freeShippingThreshold,null);assert.equal(result.source,'database');assert.equal(writes.length,0);
});
test('missing JSON settings do not add synthetic campaigns to otherwise real DB configuration',async()=>{
 const {db}=memory();db.mobileStorefrontConfig.findFirst=async()=>({freeShippingThreshold:75,tickersJson:{searchKeywords:[],subscriptionPlans:[]},updatedAt:new Date('2026-10-21')});
 const result=await getStorefrontConfig(shop,{db});assert.equal(result.store.freeShippingThreshold,75);assert.deepEqual(result.searchKeywords,[]);assert.deepEqual(result.subscriptionPlans,[]);assert.deepEqual(result.productOverrides,[]);
});
test('community writes persist real receipts, omit client prices and stock, and deduplicate retries',async()=>{
 const {db,writes}=memory();const first=await customerCommunity({...args(db),input:postInput});const second=await customerCommunity({...args(db),input:postInput});
 assert.equal(first.accepted,true);assert.equal(first.post.id,second.post.id);assert.equal(first.post.likes,0);assert.equal(first.post.views,undefined);assert.equal(first.post.recipeMeta.ingredients[0].price,undefined);assert.equal(first.post.recipeMeta.ingredients[0].stock,undefined);assert.equal(writes[0].customerId,customer);
});
test('failed customer authentication prevents community, attendance, reaction and account deletion writes',async()=>{
 const {db,writes}=memory();const verify=async()=>{throw Object.assign(new Error('expired'),{status:401});};
 for(const [fn,input] of [[customerCommunity,postInput],[customerAttendance,{}],[customerReaction,{targetType:'COMMUNITY_POST',targetId:'post',active:true}],[customerDeleteRequest,{reason:'Customer request'}]])await assert.rejects(fn({...args(db),verify,input}),{status:401});
 assert.equal(writes.length,0);
});
test('community empty feeds remain empty and cannot read another tenant',async()=>{
 const {db,rows}=memory();rows.push({id:'private',shop:'foreign.myshopify.com',type:'COMMUNITY_POST',status:'REQUESTED',payload:postInput});
 const result=await customerCommunity(args(db));assert.deepEqual(result.posts,[]);assert.equal(result.nextCursor,null);
});
test('likes count verified unique customer reactions and repeated taps cannot inflate the counter',async()=>{
 const {db,reactions}=memory();const posted=await customerCommunity({...args(db),input:postInput}),input={targetType:'COMMUNITY_POST',targetId:posted.post.id,active:true};
 const results=await Promise.all([customerReaction({...args(db),input}),customerReaction({...args(db),input})]);assert.ok(results.every(row=>row.likes===1));assert.equal(reactions.length,1);
 assert.equal((await customerReaction({...args(db),verify:async()=>other,input})).likes,2);
 assert.equal((await customerReaction({...args(db),input:{...input,active:false}})).likes,1);
 assert.equal((await customerCommunity(args(db))).posts[0].likes,1);
});
test('a reaction cannot target a post belonging to another shop or a closed post',async()=>{
 const {db,rows,reactions}=memory();rows.push({id:'foreign',shop:'foreign.myshopify.com',type:'COMMUNITY_POST',status:'REQUESTED',payload:postInput},{id:'closed',shop,type:'COMMUNITY_POST',status:'CLOSED',payload:postInput});
 for(const targetId of ['foreign','closed'])await assert.rejects(customerReaction({...args(db),input:{targetType:'COMMUNITY_POST',targetId,active:true}}),{status:404});assert.equal(reactions.length,0);
});
test('comments persist against a real post and GET reports actual totals',async()=>{
 const {db}=memory();const post=(await customerCommunity({...args(db),input:postInput})).post;
 const input={postId:post.id,text:'Customer comment',author:'Nickname'};const a=await customerComments({...args(db),input});const retry=await customerComments({...args(db),input});assert.equal(a.comment.id,retry.comment.id);
 const result=await customerComments({...args(db),request:req(undefined,`?postId=${post.id}`)});assert.equal(result.total,1);assert.equal(result.comments[0].text,input.text);
 await assert.rejects(customerComments({...args(db),input:{...input,postId:'missing'}}),{status:404});
});
test('request history is scoped to verified customer and shop and excludes device registrations',async()=>{
 const {db,rows}=memory();for(const [id,customerId,tenant,type] of [['own',customer,shop,'RETURN'],['other',other,shop,'RETURN'],['foreign',customer,'foreign.myshopify.com','RETURN'],['device',customer,shop,'PUSH_TOKEN']])rows.push({id,customerId,shop:tenant,type,status:'REQUESTED',payload:{}});
 const result=await customerRequestHistory(args(db));assert.deepEqual(result.requests.map(row=>row.id),['own']);
});
test('attendance uses server date, persists one record and never claims coupon or points issuance',async()=>{
 const {db,rows}=memory();const a=await customerAttendance({...args(db),input:{date:'1900-01-01',points:500}}),again=await customerAttendance({...args(db),input:{}});
 assert.notEqual(a.date,'1900-01-01');assert.equal(a.id,again.id);assert.equal(rows.length,1);assert.equal(a.rewardsAvailable,false);assert.equal(a.points,undefined);assert.deepEqual((await customerAttendance(args(db))).dates,[a.date]);
});
test('account deletion returns a persisted request and is idempotent, without claiming actual erasure',async()=>{
 const {db}=memory();const a=await customerDeleteRequest({...args(db),input:{reason:'Please remove my account'}}),again=await customerDeleteRequest({...args(db),input:{reason:'Retry'}});
 assert.equal(a.requestId,again.requestId);assert.equal(a.status,'REQUESTED');assert.equal(a.deleted,undefined);
});
test('photo reviews start with zero actual likes, use exact product filter, and failures are never accepted',async()=>{
 const {db}=memory();const input={dishName:'Real product',comment:'Real customer comment',rating:4,productId:'gid://shopify/Product/10'};
 const saved=await customerPhotoReviews({...args(db),input});assert.equal(saved.review.likes,0);
 const result=await customerPhotoReviews({...args(db),request:req(undefined,'?productId=gid://shopify/Product/10')});assert.equal(result.reviews.length,1);assert.equal(result.reviews[0].likes,0);
 assert.equal((await customerPhotoReviews({...args(db),request:req(undefined,'?productId=gid://shopify/Product/11')})).reviews.length,0);
 db.customerRequest.upsert=async()=>{throw new Error('database unavailable');};await assert.rejects(customerPhotoReviews({...args(db),input}),/database unavailable/);
});
test('images reject executable URLs and unsupported or oversized encodings',()=>{
 assert.equal(reviewImage(null),null);assert.equal(reviewImage('data:image/jpeg;base64,YWJj'),'data:image/jpeg;base64,YWJj');
 for(const value of ['javascript:alert(1)','data:image/svg+xml;base64,YWJj','data:image/png;base64,'+'a'.repeat(200000)])assert.throws(()=>reviewImage(value),{status:400});
});
test('subscription acceptance ignores posted prices and uses only an active persisted plan',async()=>{
 const {db,rows}=memory();db.mobileStorefrontConfig.findFirst=async()=>({tickersJson:{subscriptionPlans:[{id:'realplan',titleKo:'Real plan',price:25,isActive:true}]}});
 const resolve=createCustomerResolver({db,verify:async()=>customer});const input={planId:'realplan',planTitle:'Forged title',price:0.01,email:'customer@example.com'};
 const result=await resolve({shop,resource:'subscription-request',request:req(input)});assert.equal(result.accepted,true);assert.equal(rows[0].payload.price,25);assert.equal(rows[0].payload.planTitle,'Real plan');
 await assert.rejects(resolve({shop,resource:'subscription-request',request:req({...input,planId:'syntheticplan'})}),{status:404});
});
test('new HTTP resource methods and CORS use the shared handler without false success on persistence failure',async()=>{
 const {db}=memory();const resolve=createCustomerResolver({db,verify:async()=>customer});const handler=createCustomerHandler(resolve,{CUSTOMER_API_SHOP:shop,CUSTOMER_API_ALLOWED_ORIGINS:'https://example.com'});
 for(const resource of ['community-posts','community-comments','attendance']){
  const response=await handler({params:{resource},request:new Request('https://example.com',{method:'OPTIONS'})});assert.equal(response.status,204);assert.equal(response.headers.get('Access-Control-Allow-Methods'),'GET, POST, OPTIONS');
 }
 db.customerRequest.upsert=async()=>{throw new Error('PRIVATE_DATABASE_ERROR');};const response=await handler({params:{resource:'community-posts'},request:req(postInput)});assert.equal(response.status,502);const body=await response.text();assert.ok(!body.includes('PRIVATE_DATABASE_ERROR'));assert.equal(JSON.parse(body).success,false);
});
