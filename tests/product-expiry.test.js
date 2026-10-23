import test from "node:test";
import assert from "node:assert/strict";
import { normalizeExpiryDate, expiryInfo } from "../app/utils/productExpiry.js";
import { listExpiryProducts, saveProductExpiry } from "../app/services/productExpiry.server.js";
const id=n=>"gid://shopify/Product/"+n;
const response=data=>Response.json({data});
test("dates distinguish unset, invalid, today, approaching and expired without guessing",()=>{
 assert.equal(normalizeExpiryDate("2027-02-30"),"");assert.equal(normalizeExpiryDate("18.11.2026"),"");
 assert.equal(normalizeExpiryDate("2027-01-01T00:00:00Z"),"2027-01-01");
 assert.equal(expiryInfo("","2026-10-23").status,"unset");
 assert.equal(expiryInfo("bad","2026-10-23").status,"invalid");
 assert.equal(expiryInfo("2026-10-23","2026-10-23").status,"today");
 assert.equal(expiryInfo("2026-10-22","2026-10-23").days,-1);
 assert.equal(expiryInfo("2026-10-30","2026-10-23").days,7);
});
test("expiry catalog reads actual freshly field; missing stays missing and invalid raw is preserved for review",async()=>{
 const admin={graphql:async(query)=>{assert.match(query,/namespace: "freshly", key: "expiry_date"/);return response({products:{nodes:[{id:id(1),title:"Actual",totalInventory:0,tracksInventory:true,expiryDate:{value:"2027-01-01"},producttype:{value:"k"}},{id:id(2),title:"Missing"},{id:id(3),title:"Invalid",expiryDate:{value:"unknown"}}],pageInfo:{hasNextPage:false,endCursor:null}}});}};
 const result=await listExpiryProducts({admin,db:new Proxy({},{get(){throw Error("No CMS reads");}})});
 assert.equal(result.items[0].expiryDate,"2027-01-01");assert.equal(result.items[0].inventory,0);assert.equal(result.items[0].storageTemp,"chilled");
 assert.equal(result.items[1].expiryDate,"");assert.equal(result.items[2].expiryRaw,"unknown");assert.equal(result.source,"freshly.expiry_date");
});
test("writes only freshly.expiry_date using existing type and compareDigest",async()=>{
 const calls=[];
 const admin={graphql:async(query,{variables})=>{
 calls.push({query,variables});
 if(variables.ids)return response({nodes:[{id:id(1),expiryDate:{type:"date",compareDigest:"original"}},{id:id(2),expiryDate:{type:"date_time",compareDigest:"timestamp"}}]});
 return response({metafieldsSet:{userErrors:[],metafields:variables.metafields.map(field=>({...field,owner:{id:field.ownerId}}))}});
 }};
 const result=await saveProductExpiry({admin,input:{productIds:[id(1),id(2)],expiryDate:"2027-01-01"}});
 assert.equal(result.updatedCount,2);assert.ok(result.saveId);
 assert.deepEqual(calls[1].variables.metafields,[{ownerId:id(1),namespace:"freshly",key:"expiry_date",value:"2027-01-01",type:"date",compareDigest:"original"},{ownerId:id(2),namespace:"freshly",key:"expiry_date",value:"2027-01-01T00:00:00Z",type:"date_time",compareDigest:"timestamp"}]);
});
test("invalid dates, foreign ids and oversized individual requests fail before Shopify",async()=>{
 for(const input of [{productIds:[id(1)],expiryDate:"2027-02-30"},{productIds:[id(1)],expiryDate:""},{productIds:["gid://shopify/Customer/1"],expiryDate:"2027-01-01"},{productIds:Array(26).fill(id(1)),expiryDate:"2027-01-01"}]){
 await assert.rejects(saveProductExpiry({admin:{graphql(){throw Error("must not call");}},input}),e=>e.status===400);
 }
});
test("missing product and incompatible metafield type prevent all writes",async()=>{
 for(const nodes of [[null],[{id:id(1),expiryDate:{type:"list.date"}}]]){
 let calls=0;await assert.rejects(saveProductExpiry({admin:{graphql:async()=>{calls++;return response({nodes});}},input:{productIds:[id(1)],expiryDate:"2027-01-01"}}));assert.equal(calls,1);
 }
});
test("Shopify rejection, unknown receipt and network failure never report success or retry",async()=>{
 for(const mode of ["rejected","receipt","network"]){
 let calls=0;
 const admin={graphql:async(_,{variables})=>{calls++;if(variables.ids)return response({nodes:[{id:id(1),expiryDate:null}]});if(mode==="network")throw Error("timeout");return response({metafieldsSet:{userErrors:mode==="rejected"?[{code:"INVALID_COMPARE_DIGEST"}]:[],metafields:[]}});}};
 await assert.rejects(saveProductExpiry({admin,input:{productIds:[id(1)],expiryDate:"2027-01-01"}}),error=>{
 assert.equal(error.status,mode==="rejected"?409:502);
 assert.deepEqual(error.details.uncertainProductIds,mode==="rejected"?undefined:[id(1)]);return true;
 });assert.equal(calls,2);
 }
});
test("repeated pagination and GraphQL failure cannot produce a successful truncated expiry list",async()=>{
 await assert.rejects(listExpiryProducts({admin:{graphql:async()=>response({products:{nodes:[],pageInfo:{hasNextPage:true,endCursor:"same"}}})},after:"same"}));
 await assert.rejects(listExpiryProducts({admin:{graphql:async()=>Response.json({errors:[{}]})}}));
});
