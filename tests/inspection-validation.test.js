import test from "node:test";
import assert from "node:assert/strict";
import { normalizeInspectionItems, restoreSavedInspections, normalizeOperationalInspectionItems } from "../app/services/inspectionValidation.js";
const variant={id:"gid://shopify/ProductVariant/5",barcode:"REAL-BARCODE"};
const lines=[{id:"a",quantity:2,title:"Real",sku:"SKU",variant},{id:"b",quantity:1,title:"Other",sku:"SKU",variant}];
const input=lines.map(line=>({id:line.id,orderedQuantity:line.quantity,inspectedQuantity:0,issueType:null}));
test("inspection rejects empty, missing, duplicated or changed order lines",()=>{
  for(const value of [[],input.slice(0,1),[input[0],input[0]],[{...input[0],id:"foreign"},input[1]],[{...input[0],orderedQuantity:99},input[1]]]) assert.throws(()=>normalizeInspectionItems(value,lines));
});
test("inspection rejects negative, fractional, excessive and nonnumeric quantities",()=>{
  for(const quantity of [-1,0.5,3,"1",NaN]) assert.throws(()=>normalizeInspectionItems([{...input[0],inspectedQuantity:quantity},input[1]],lines));
});
test("inspection uses authoritative product fields and validates exception types",()=>{
  const result=normalizeInspectionItems([{...input[0],title:"Fake",productTitle:"Forged API title",variantId:"fake",barcode:"FORGED"},input[1]],lines);
  assert.equal(result[0].title,"Real");assert.equal(result[0].productTitle,"Real");assert.equal(result[0].variantId,variant.id);assert.equal(result[0].barcode,"REAL-BARCODE");
  assert.throws(()=>normalizeInspectionItems([{...input[0],issueType:"INVALID"},input[1]],lines));
  assert.throws(()=>normalizeInspectionItems([{...input[0],issueType:"SUBSTITUTE",substitutedVariantId:"fake"},input[1]],lines));
});
test("same-variant lines restore separately and ambiguous legacy data is not assigned",()=>{
  const saved=[{orderLineId:"a",inspectedQuantity:2},{orderLineId:"b",inspectedQuantity:0}];
  const restored=restoreSavedInspections(lines,saved);
  assert.equal(restored.get("a").inspectedQuantity,2);assert.equal(restored.get("b").inspectedQuantity,0);
  assert.equal(restoreSavedInspections(lines,[{variantId:variant.id,inspectedQuantity:2}]).size,0);
  assert.equal(restoreSavedInspections([lines[0]],[{variantId:variant.id,inspectedQuantity:2}]).get("a").inspectedQuantity,2);
});

test("operational inspection requires line IDs for repeated variants and preserves unambiguous legacy input",()=>{
 assert.throws(()=>normalizeOperationalInspectionItems(input.map(item=>({...item,id:undefined,variantId:variant.id})),lines));
 const result=normalizeOperationalInspectionItems([{orderLineId:"a",orderedQuantity:2,inspectedQuantity:2},{orderLineId:"b",orderedQuantity:1,inspectedQuantity:0}],lines);
 assert.deepEqual(result.map(item=>item.id),["a","b"]);
 const single=normalizeOperationalInspectionItems([{variantId:variant.id,inspectedQuantity:1}],lines.slice(0,1));assert.equal(single[0].id,"a");
});
