import test from "node:test";
import assert from "node:assert/strict";
import { listAttributeProducts, saveProductAttributes, validateAttributePatch } from "../app/services/productAttributes.server.js";
import { attributesFromRule } from "../app/utils/productAttributes.js";
const id = n => "gid://shopify/Product/" + n;
const product = (n, extra = {}) => ({ id: id(n), title: "Actual product " + n, totalInventory: n === 1 ? 0 : 9, tracksInventory: true,
 variants: { nodes: [{ sku: "SKU-" + n }] }, featuredMedia: { preview: { image: { url: "https://cdn.shopify.com/real.jpg" } } }, producttype: { value: "k" }, ...extra });
function database(config = {}) {
 let record = { id: "config", shop: "fixed.myshopify.com", updatedAt: new Date(1000), freeShippingThreshold: 85, tickersJson: structuredClone(config), configVersion: "old" };
 const writes = [];
 const db = { mobileStorefrontConfig: {
  findUnique: async ({ where }) => { assert.equal(where.shop, "fixed.myshopify.com"); return structuredClone(record); },
  updateMany: async args => { assert.equal(args.where.shop, "fixed.myshopify.com"); assert.equal(args.where.updatedAt.getTime(), record.updatedAt.getTime()); writes.push(args); record = { ...record, ...structuredClone(args.data), updatedAt: new Date(record.updatedAt.getTime() + 1) }; return { count: 1 }; },
  create: async args => { writes.push(args); record = { ...args.data, id: "created", updatedAt: new Date(1000) }; return record; },
 } };
 return { db, writes, get record() { return record; }, set record(value) { record = value; } };
}
const admin = { graphql: async (query, { variables }) => {
 assert.ok(!query.includes("mutation"), "attribute editor must not change Shopify prices, inventory or metafields");
 return Response.json({ data: { nodes: variables.ids.map(value => product(Number(value.split("/").pop()))) } });
} };
const save = (state, patch, ids = [id(1)], api = admin) => saveProductAttributes({ admin: api, db: state.db, shop: "fixed.myshopify.com", input: { productIds: ids, patch } });
test("real catalog includes unset products, actual photo, zero inventory and canonical temperature", async () => {
 const state = database({ productOverrides: [{ id: "rule", productId: id(1), isMhdDeal: true, mhdDate: "2027-01-01" }] });
 let query;
 const result = await listAttributeProducts({ db: state.db, shop: "fixed.myshopify.com", admin: { graphql: async q => {
 query = q; return Response.json({ data: { products: { nodes: [product(1), product(2, { tracksInventory: false, producttype: null })], pageInfo: { hasNextPage: false, endCursor: null } } } }); } } });
 assert.match(query,/custom/); assert.match(query,/producttype/);
 assert.equal(result.items[0].inventory,0); assert.equal(result.items[0].imageUrl,"https://cdn.shopify.com/real.jpg");
 assert.equal(result.items[0].attributes.mhdDate,"2027-01-01"); assert.equal(result.items[0].storageTemp,"chilled");
 assert.equal(result.items[1].inventory,null); assert.equal(result.items[1].hasAttributes,false); assert.equal(result.items[1].storageTemp,"");
 assert.equal(state.writes.length,0);
});
test("pagination and Shopify failure never become successful partial catalogs", async () => {
 const state = database();
 const list = api => listAttributeProducts({ admin: api, db: state.db, shop: "fixed.myshopify.com", after: "same" });
 await assert.rejects(list({graphql:async()=>Response.json({data:{products:{nodes:[],pageInfo:{hasNextPage:true,endCursor:"same"}}}})}),e=>e.status===502);
 await assert.rejects(list({graphql:async()=>Response.json({errors:[{message:"denied"}]})}),e=>e.status===502);
});
test("only checked attributes change; MHD, locales, temperature maps and unrelated settings survive", async () => {
 const old = { id: "rule", productId: id(1), mhdDate: "2027-01-01", mhdPrice: 3.9, ageRestriction: "18+", bundleBadgeDe: "Keep German", storageTemp: "frozen" };
 const state = database({ banners: ["keep"], productTemperatures: { [id(1)]: "ambient" }, productOverrides: [old, { id: "other", productId: id(9), pfand: .25 }] });
 const result = await save(state,{isCartFiller:true});
 assert.equal(result.updatedCount,1); assert.ok(result.saveId);
 const current = state.record.tickersJson.productOverrides.find(rule=>rule.productId===id(1));
 for(const key of ["mhdDate","mhdPrice","ageRestriction","bundleBadgeDe","storageTemp"])assert.equal(current[key],old[key]);
 assert.equal(current.isCartFiller,true); assert.deepEqual(state.record.tickersJson.banners,["keep"]);
 assert.deepEqual(state.record.tickersJson.productTemperatures,{[id(1)]:"ambient"}); assert.equal(state.record.freeShippingThreshold,85);
 assert.equal(state.record.tickersJson.productOverrides.find(rule=>rule.productId===id(9)).pfand,.25);
});
test("MHD off clears date and reference price, never changes real Shopify sale price",async()=>{
 const state=database({productOverrides:[{id:"old",productId:id(1),isMhdDeal:true,mhdDate:"2027-01-01",mhdPrice:2,isCartFiller:true}]});
 const result=await save(state,{isMhdDeal:false});
 assert.equal(result.items[0].attributes.isMhdDeal,false);assert.equal(result.items[0].attributes.mhdDate,"");assert.equal(result.items[0].attributes.mhdPrice,null);
 assert.equal(result.items[0].attributes.isCartFiller,true);
});
test("new MHD date enables MHD and an empty checked text clears only that locale",async()=>{
 const state=database({productOverrides:[{id:"old",productId:id(1),bundleBadgeKo:"old",bundleBadgeDe:"behalten"}]});
 await save(state,{mhdDate:"2027-02-28",bundleBadgeKo:""});
 const row=state.record.tickersJson.productOverrides[0];
 assert.equal(row.isMhdDeal,true);assert.equal(row.bundleBadgeKo,"");assert.equal(row.bundleBadgeDe,"behalten");
});
test("validation rejects invalid dates, money, unsupported fields and incompatible MHD changes",()=>{
 for(const patch of [{mhdDate:"2027-02-30"},{mhdDate:"2027-1-01"},{mhdPrice:-1},{mhdPrice:"NaN"},{pfand:.123},{pfand:true},{isCartFiller:"true"},{ageRestriction:"12+"},{storageTemp:"frozen"},{productId:id(2)},{isMhdDeal:false,mhdDate:"2027-01-01"},{isMhdDeal:false,mhdPrice:2},{constructor:"bad"},{}]){
 assert.throws(()=>validateAttributePatch({productIds:[id(1)],patch}));
 }
 assert.equal(validateAttributePatch({productIds:[id(1)],patch:{mhdPrice:"",pfand:"0.25"}}).patch.mhdPrice,null);
});
test("invalid selection or empty patch fails before Shopify or database writes",async()=>{
 for(const input of [{productIds:[],patch:{pfand:0}},{productIds:Array(101).fill(id(1)),patch:{pfand:0}},{productIds:["gid://shopify/Customer/1"],patch:{pfand:0}},{productIds:[id(1)],patch:{}}]){
 let called=false;await assert.rejects(saveProductAttributes({admin:{graphql:()=>{called=true;}},db:{},shop:"fixed",input}));assert.equal(called,false);
 }
});
test("missing and malformed products reject entire batch before database writes",async()=>{
 for(const node of [null,{id:id(1)}]){
 const state=database();
 await assert.rejects(save(state,{isCartFiller:true},[id(1)],{graphql:async()=>Response.json({data:{nodes:[node]}})}));assert.equal(state.writes.length,0);
 }
});
test("legacy SKU fields are copied only to selected exact products without losing MHD",async()=>{
 const state=database({productOverrides:[{id:"legacy",productId:"old-id",sku:"SKU-1",mhdDate:"2027-01-01",ageRestriction:"18+"}]});
 await save(state,{pfand:.25});
 const rules=state.record.tickersJson.productOverrides;
 assert.equal(rules.length,2);assert.equal(rules[0].productId,id(1));assert.equal(rules[0].mhdDate,"2027-01-01");
 assert.equal(rules[0].ageRestriction,"18+");assert.equal(rules[1].productId,"old-id");
});
test("concurrent edits reapply only requested fields to latest config",async()=>{
 const state=database({productOverrides:[{id:"old",productId:id(1),mhdDate:"2027-01-01"}]});
 const write=state.db.mobileStorefrontConfig.updateMany;let attempts=0;
 state.db.mobileStorefrontConfig.updateMany=async args=>{
 if(++attempts===1){state.record={...state.record,updatedAt:new Date(2000),tickersJson:{newSetting:"keep",productOverrides:[{id:"old",productId:id(1),mhdDate:"2027-03-01",ageRestriction:"18+"}]}};return {count:0};}
 return write(args);};
 await save(state,{isUpcomingDeal:true});
 assert.equal(attempts,2);assert.equal(state.record.tickersJson.newSetting,"keep");
 assert.equal(state.record.tickersJson.productOverrides[0].mhdDate,"2027-03-01");assert.equal(state.record.tickersJson.productOverrides[0].ageRestriction,"18+");
});
test("persistent concurrency conflict cannot report successful saves",async()=>{
 const state=database();let writes=0;state.db.mobileStorefrontConfig.updateMany=async()=>{writes++;return {count:0};};
 await assert.rejects(save(state,{pfand:0}),e=>e.status===409);assert.equal(writes,3);
});
test("first attribute save creates no fabricated shipping policy",async()=>{
 const state=database();state.record=null;
 await save(state,{isCartFiller:true});
 assert.equal(state.record.freeShippingThreshold,0);assert.equal(state.record.tickersJson.shippingPolicyConfigured,false);
 assert.equal(state.record.shippingNoticeKo,"");assert.equal(state.record.tickersJson.productOverrides[0].productId,id(1));
});
test("malformed saved settings cannot be overwritten by attribute editor",async()=>{
 const state=database();state.record.tickersJson="{bad";
 await assert.rejects(save(state,{pfand:.25}),e=>e.status===409);assert.equal(state.writes.length,0);
});
test("a hundred selected products are saved once with individual unmodified fields retained",async()=>{
 const state=database({productOverrides:Array.from({length:100},(_,n)=>({id:"rule-"+n,productId:id(n+1),mhdDate:n%2?"2027-01-01":""}))});
 const result=await save(state,{isCartFiller:true},Array.from({length:100},(_,n)=>id(n+1)));
 assert.equal(result.updatedCount,100);assert.equal(state.writes.length,1);
 assert.equal(result.items[1].attributes.mhdDate,"2027-01-01");assert.equal(result.items[0].attributes.mhdDate,"");
 assert.equal(attributesFromRule().pfand,0);
});
