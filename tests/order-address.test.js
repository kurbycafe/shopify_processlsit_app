import test from "node:test";
import assert from "node:assert/strict";
import { saveOrderAddress } from "../app/services/orderAddress.server.js";
const shop="test.myshopify.com";
function dependencies(){
 const calls=[],writes=[];
 const admin={graphql:async(query,options)=>{calls.push(options.variables);return Response.json(query.includes("OrderAddressOwner")?{data:{order:{id:"gid://shopify/Order/123",name:"#123",customer:{id:"gid://shopify/Customer/5"}}}}:{data:{metafieldsSet:{metafields:[],userErrors:[]}}});}};
 const db={inspectionRecord:{findUnique:async()=>null,upsert:async input=>writes.push(input)}};
 const formData=new FormData();formData.set("customerId","gid://shopify/Customer/999");formData.set("customVat","DE123");
 return {admin,db,formData,calls,writes,shop,rawId:"123"};
}
test("VAT write targets actual order customer, ignores forged customerId/name/shop",async()=>{
 const deps=dependencies();await saveOrderAddress(deps);
 assert.equal(deps.calls[1].metafields[0].ownerId,"gid://shopify/Customer/5");
 assert.equal(deps.writes[0].create.orderName,"#123");assert.equal(deps.writes[0].create.shop,shop);
});
test("foreign or missing orders and malformed addresses never write",async()=>{
 const deps=dependencies();deps.db.inspectionRecord.findUnique=async()=>({shop:"other.myshopify.com"});
 await assert.rejects(saveOrderAddress(deps));assert.equal(deps.writes.length,0);assert.equal(deps.calls.length,1);
 const invalid=dependencies();invalid.formData.set("shippingAddress",JSON.stringify({address1:{invalid:true}}));
 await assert.rejects(saveOrderAddress(invalid));assert.equal(invalid.calls.length,0);
 const bulk=dependencies();bulk.rawId="123,124";await assert.rejects(saveOrderAddress(bulk));
});
test("failed remote VAT update cannot be reported as successful address save",async()=>{
 const deps=dependencies();deps.admin.graphql=async query=>Response.json(query.includes("OrderAddressOwner")?{data:{order:{id:"gid://shopify/Order/123",name:"#123",customer:{id:"gid://shopify/Customer/5"}}}}:{data:{metafieldsSet:{userErrors:[{message:"denied"}]}}});
 await assert.rejects(saveOrderAddress(deps));assert.equal(deps.writes.length,0);
});

test("ordinary blank-VAT address edits do not send invalid empty metafield values",async()=>{
 const deps=dependencies();deps.formData.set("customVat","");await saveOrderAddress(deps);assert.equal(deps.calls.length,1);assert.equal(deps.writes.length,1);
});
test("clearing an existing VAT uses deletion for the actual order customer",async()=>{
 const deps=dependencies();deps.formData.set("customVat","");const queries=[];
 deps.admin.graphql=async(query,options)=>{queries.push(query);deps.calls.push(options.variables);return Response.json(query.includes("OrderAddressOwner")?{data:{order:{id:"gid://shopify/Order/123",name:"#123",customer:{id:"gid://shopify/Customer/5",vat:{value:"DE123"}}}}}:{data:{metafieldsDelete:{deletedMetafields:[],userErrors:[]}}});};
 await saveOrderAddress(deps);assert.ok(queries[1].includes("metafieldsDelete"));assert.equal(deps.calls[1].metafields[0].ownerId,"gid://shopify/Customer/5");
});
