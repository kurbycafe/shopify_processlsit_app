import test from "node:test";
import assert from "node:assert/strict";
import { listTemperatureProducts, saveProductTemperatures, validateTemperatureChange } from "../app/services/productTemperatures.server.js";
import { temperatureFromProductType } from "../app/utils/productTemperatures.js";
import { customerProductTemperatures } from "../app/services/customerProductTemperatures.server.js";
import { getStorefrontConfig } from "../app/services/mobileStorefront.server.js";

const id = value => "gid://shopify/Product/" + value;
const response = data => Response.json({ data });
test("only custom producttype codes classify temperature", () => {
 for (const [code, expected] of [["t","ambient"],["k","chilled"],["tk","frozen"],[" TK ","frozen"],[null,""],["",""],["frozen",""],["냉동",""],["invalid",""]]) assert.equal(temperatureFromProductType(code), expected);
});
test("management reads Shopify metafield, never CMS or SKU overrides", async () => {
 let query;
 const admin = { graphql: async q => { query=q; return response({ products: {
 nodes: ["t","k","tk",null,"frozen"].map((code,index)=>({id:id(index+1),title:"냉동 만두", producttype:code===null?null:{value:code},totalInventory:0,tracksInventory:true})),
 pageInfo:{hasNextPage:false,endCursor:null}}}); }};
 const db = { mobileStorefrontConfig:{findUnique:()=>{throw Error("must not read CMS");}}};
 const result=await listTemperatureProducts({admin,db,shop:"shop"});
 assert.match(query,/metafield\(namespace: "custom", key: "producttype"\)/);
 assert.deepEqual(result.items.map(item=>item.storageTemp),["ambient","chilled","frozen","",""]);
 assert.equal(result.items[0].inventory,0);
});
test("pagination and Shopify failures do not silently truncate listing", async () => {
 await assert.rejects(listTemperatureProducts({admin:{graphql:async()=>response({products:{nodes:[],pageInfo:{hasNextPage:true,endCursor:"same"}}})},after:"same"}),e=>e.status===502);
 await assert.rejects(listTemperatureProducts({admin:{graphql:async()=>Response.json({errors:[{message:"denied"}]})}}),e=>e.status===502);
});
test("bulk validates 250-product selection and rejects invalid fields",()=>{
 for(const input of [{productIds:[],storageTemp:"chilled"},{productIds:Array(251).fill(id(1)),storageTemp:"chilled"},{productIds:["gid://shopify/Customer/1"],storageTemp:"chilled"},{productIds:[id(1)],storageTemp:"cold"}])assert.throws(()=>validateTemperatureChange(input));
});
test("bulk writes exact custom.producttype with compareDigest and never writes local settings", async()=>{
 const calls=[];
 const admin={graphql:async(query,{variables})=>{
 calls.push({query,variables});
 if(variables.ids)return response({nodes:variables.ids.map((productId,index)=>({id:productId,producttype:index===0?{value:"t",type:"single_line_text_field",compareDigest:"original"}:null}))});
 return response({metafieldsSet:{userErrors:[],metafields:variables.metafields.map(field=>({...field,owner:{id:field.ownerId}}))}});
 }};
 const result=await saveProductTemperatures({admin,input:{productIds:[id(1),id(2),id(1)],storageTemp:"frozen"},db:new Proxy({},{get(){throw Error("no database writes");}})});
 assert.equal(calls.length,2);
 assert.deepEqual(calls[1].variables.metafields,[
 {ownerId:id(1),namespace:"custom",key:"producttype",value:"tk",type:"single_line_text_field",compareDigest:"original"},
 {ownerId:id(2),namespace:"custom",key:"producttype",value:"tk",compareDigest:null}
 ]);
 assert.equal(result.updatedCount,2);assert.ok(result.saveId);
});
test("deleted product rejects entire batch before mutation",async()=>{
 let calls=0;
 await assert.rejects(saveProductTemperatures({admin:{graphql:async()=>{calls++;return response({nodes:[null]});}},input:{productIds:[id(1)],storageTemp:"ambient"}}),e=>e.status===400);
 assert.equal(calls,1);
});
test("conflict, incomplete receipt, and uncertain write are never retried or reported successful",async()=>{
 for(const mode of ["conflict","incomplete","network"]){
 let calls=0;
 const admin={graphql:async(_,{variables})=>{
 calls++;
 if(variables.ids)return response({nodes:[{id:id(1),producttype:null}]});
 if(mode==="network")throw Error("timeout");
 return response({metafieldsSet:{userErrors:mode==="conflict"?[{code:"INVALID_COMPARE_DIGEST"}]:[],metafields:[]}});}};
 await assert.rejects(saveProductTemperatures({admin,input:{productIds:[id(1)],storageTemp:"chilled"}}));
 assert.equal(calls,2);
 }
});
test("public API reads same canonical field and reveals no draft or unpublished metadata",async()=>{
 const request=new Request("https://example.test/api/customer/v1/product-temperatures?ids=1,2,3,4");
 let variables;
 const result=await customerProductTemperatures({request,shop:"fixed.myshopify.com",graphql:async(shop,query,args)=>{
 assert.equal(shop,"fixed.myshopify.com");assert.match(query,/key: "producttype"/);variables=args;
 return {data:{nodes:[
 {id:id(1),status:"ACTIVE",onlineStoreUrl:"https://shop/products/one",producttype:{value:"k"}},
 {id:id(2),status:"DRAFT",onlineStoreUrl:null,producttype:{value:"tk"}},
 {id:id(3),status:"ACTIVE",onlineStoreUrl:null,producttype:{value:"t"}},
 {id:id(4),status:"ACTIVE",onlineStoreUrl:"https://shop/products/four",producttype:null}
 ]}};}});
 assert.deepEqual(variables.ids,[id(1),id(2),id(3),id(4)]);
 assert.deepEqual(result.items.map(item=>item.productTemperatureCode),["k","","",""]);
});
test("public lookup validates size and resource ids before Admin calls",async()=>{
 for(const ids of ["","abc","gid://shopify/Customer/1",Array(101).fill("1").join(",")]){
 await assert.rejects(customerProductTemperatures({request:new Request("https://example.test/?ids="+encodeURIComponent(ids)),shop:"fixed",graphql:()=>{throw Error("must not call");}}),e=>e.status===400);
 }
});
test("CMS overrides retain MHD but cannot publish legacy temperature",async()=>{
 const rules=[{id:"mhd",productId:id(1),storageTemp:"frozen",mhdDate:"2027-01-01"}];
 const db={mobileStorefrontConfig:{findFirst:async()=>({freeShippingThreshold:0,tickersJson:{productOverrides:rules,productTemperatures:{[id(1)]:"chilled"}}})},mobileBanner:{findMany:async()=>[]},mobileHotDeal:{findMany:async()=>[]},mobileCategoryConfig:{findMany:async()=>[]}};
 const config=await getStorefrontConfig("shop.myshopify.com",{db,includeInactive:true});
 assert.equal(config.productOverrides[0].storageTemp,undefined);assert.equal(config.productOverrides[0].mhdDate,"2027-01-01");
 assert.equal(config.store.freeShippingThreshold,0);
});

test("43 selected products save as 25 and 18 fields without exceeding Shopify limit",async()=>{
 const batches=[];
 const productIds=Array.from({length:43},(_,index)=>id(index+1));
 const admin={graphql:async(_,{variables})=>{
 if(variables.ids)return response({nodes:variables.ids.map(id=>({id,producttype:null}))});
 batches.push(variables.metafields);
 return response({metafieldsSet:{userErrors:[],metafields:variables.metafields.map(field=>({...field,owner:{id:field.ownerId}}))}});
 }};
 const result=await saveProductTemperatures({admin,input:{productIds,storageTemp:"chilled"}});
 assert.deepEqual(batches.map(batch=>batch.length),[25,18]);
 assert.equal(result.updatedCount,43);assert.deepEqual(result.productIds,productIds);
 assert.ok(batches.flat().every(field=>field.namespace==="custom" && field.key==="producttype" && field.value==="k"));
});
test("250 selected products fit ten requests and a missing last product prevents all writes",async()=>{
 const productIds=Array.from({length:250},(_,index)=>id(index+1));
 let writes=0,missing=false;
 const admin={graphql:async(_,{variables})=>{
 if(variables.ids)return response({nodes:variables.ids.map((id,index)=>missing && index===249?null:{id,producttype:null})});
 writes++;assert.ok(variables.metafields.length<=25);
 return response({metafieldsSet:{userErrors:[],metafields:variables.metafields.map(field=>({...field,owner:{id:field.ownerId}}))}});
 }};
 assert.equal((await saveProductTemperatures({admin,input:{productIds,storageTemp:"ambient"}})).updatedCount,250);assert.equal(writes,10);
 writes=0;missing=true;
 await assert.rejects(saveProductTemperatures({admin,input:{productIds,storageTemp:"ambient"}}),e=>e.status===400);assert.equal(writes,0);
});
test("a later rejected or uncertain batch reports only confirmed saves and stops",async()=>{
 const productIds=Array.from({length:60},(_,index)=>id(index+1));
 for(const mode of ["rejected","timeout","receipt"]){
 let writes=0;
 const admin={graphql:async(_,{variables})=>{
 if(variables.ids)return response({nodes:variables.ids.map(id=>({id,producttype:null}))});
 writes++;
 if(writes===2){
 if(mode==="timeout")throw Error("timeout");
 return response({metafieldsSet:{userErrors:mode==="rejected"?[{code:"INVALID_COMPARE_DIGEST"}]:[],metafields:[]}});}
 return response({metafieldsSet:{userErrors:[],metafields:variables.metafields.map(field=>({...field,owner:{id:field.ownerId}}))}});
 }};
 await assert.rejects(saveProductTemperatures({admin,input:{productIds,storageTemp:"frozen"}}),error=>{
 assert.deepEqual(error.details.updatedProductIds,productIds.slice(0,25));
 assert.deepEqual(error.details.pendingProductIds,productIds.slice(25));
 assert.deepEqual(error.details.uncertainProductIds,mode==="rejected"?[]:productIds.slice(25,50));
 assert.match(error.message,/25개 상품은 저장/);
 return true;});
 assert.equal(writes,2);
 }
});
