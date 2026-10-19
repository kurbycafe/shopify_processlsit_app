import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {MobileApiError,readId} from "../app/services/mobileApi.server.js";
import {normalizeOperationalInspectionItems} from "../app/services/inspectionValidation.js";
import {validateInspectionSubstitutes} from "../app/services/inspectionOrders.server.js";
const shop="test.myshopify.com",id="gid://shopify/Order/123";
const order={id,name:"#123",lineItems:{edges:[{node:{id:"line1",title:"Real",quantity:2,variant:{id:"gid://shopify/ProductVariant/5"}}}]}};
function action(overrides={}){
 const path=new URL("../app/routes/api.inspection-history.jsx",import.meta.url);
 const source=ts.createSourceFile(path.pathname,readFileSync(path,"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
 let expression;
 for(const statement of source.statements)if(ts.isVariableStatement(statement))for(const decl of statement.declarationList.declarations)if(decl.name.getText(source)==="action")expression=decl.initializer.getText(source);
 const dependencies={getCorsHeaders:()=>({}),operationalIdentity:()=>({shop}),MobileApiError,readId,normalizeOperationalInspectionItems,
   validateInspectionSubstitutes,ensureDatabaseSchema:async()=>{},unauthenticated:{admin:async tenant=>{assert.equal(tenant,shop);return {admin:{}};}},
   readInspectionOrder:async()=>structuredClone(order),prisma:{$transaction:()=>assert.fail("must not save invalid data")},...overrides};
 return new Function(...Object.keys(dependencies),`return (${expression});`)(...Object.values(dependencies));
}
function request(items,extra={}){return new Request("https://example.com/api/inspection-history",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({orderId:id,orderName:"forgedname",items,...extra})});}
test("legacy inspection rejects empty, excessive quantity and forced SUCCESS before persistence",async()=>{
 const run=action();for(const [items,extra] of [[[],{}],[[{variantId:"gid://shopify/ProductVariant/5",orderedQuantity:2,inspectedQuantity:3}],{}],[[{variantId:"gid://shopify/ProductVariant/5",orderedQuantity:2,inspectedQuantity:1}],{status:"SUCCESS"}]]){
  assert.equal((await run({request:request(items,extra)})).status,400);
 }
});
test("legacy inspection cannot create a record for an order absent from token's shop",async()=>{
 const run=action({readInspectionOrder:async()=>null});assert.equal((await run({request:request([{id:"line1",inspectedQuantity:2}])})).status,404);
});
test("legacy successful save uses server order metadata and original order-line ID under a lock",async()=>{
 let locked=false,saved;
 const run=action({prisma:{$transaction:async fn=>fn({$executeRaw:async()=>{locked=true;},inspectionRecord:{findUnique:async()=>null,create:async({data})=>{assert.equal(locked,true);saved=data;return data;}}})}});
 const response=await run({request:request([{variantId:"gid://shopify/ProductVariant/5",orderedQuantity:2,inspectedQuantity:1}],{shop:"other.myshopify.com"})});
 assert.equal((await response.json()).success,true);assert.equal(saved.shop,shop);assert.equal(saved.orderName,"#123");assert.equal(saved.status,"PARTIAL");assert.equal(saved.items.create[0].orderLineId,"line1");
});
test("substitution validation uses real variant metadata and rejects missing variants",async()=>{
 const items=[{issueType:"SUBSTITUTE",substitutedVariantId:"gid://shopify/ProductVariant/7",substitutedProductTitle:"Forged"}];
 await validateInspectionSubstitutes({graphql:async()=>Response.json({data:{nodes:[{id:items[0].substitutedVariantId,title:"Default Title",product:{title:"Real replacement"}}]}})},items);
 assert.equal(items[0].substitutedProductTitle,"Real replacement");
 await assert.rejects(validateInspectionSubstitutes({graphql:async()=>Response.json({data:{nodes:[null]}})},items));
});

test("legacy inspection rejects malformed JSON and non-object bodies as client errors",async()=>{
 const run=action();
 for(const body of ["{", "null", "[]", "true"]){
  const response=await run({request:new Request("https://example.com/api/inspection-history",{method:"POST",headers:{"Content-Type":"application/json"},body})});
  assert.equal(response.status,400);assert.equal((await response.json()).error.code,"VALIDATION_ERROR");
 }
});
