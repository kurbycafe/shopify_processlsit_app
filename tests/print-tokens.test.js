import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { generatePrintToken, verifyPrintToken } from "../app/utils/printTokens.js";
process.env.SHOPIFY_API_SECRET ||= "test-secret-for-tokens";
const shop="test.myshopify.com";
test("expiring print tokens are limited to the signed order and shop",()=>{
  const token=generatePrintToken("123",shop);
  assert.equal(verifyPrintToken("gid://shopify/Order/123",shop,token),true);
  assert.equal(verifyPrintToken("124",shop,token),false);
  assert.equal(verifyPrintToken("123","other.myshopify.com",token),false);
  for(const bad of [token+".extra",token.replace(".","x."),"",null]) assert.equal(verifyPrintToken("123",shop,bad),false);
});
test("expired and legacy static print tokens are rejected",()=>{
  const legacy=createHmac("sha256",process.env.SHOPIFY_API_SECRET).update(`123:${shop}`).digest("hex");
  assert.equal(verifyPrintToken("123",shop,legacy),false);
  const old=Date.now;Date.now=()=>old()-49*3600*1000;const expired=generatePrintToken("123",shop);Date.now=old;
  assert.equal(verifyPrintToken("123",shop,expired),false);
  assert.throws(()=>generatePrintToken("123",shop,Infinity));
  assert.throws(()=>generatePrintToken("Product/123",shop));
});
