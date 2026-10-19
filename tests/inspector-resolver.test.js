import test from "node:test";
import assert from "node:assert/strict";
import { getInspectorName } from "../app/services/inspectorService.server.js";

test("current associated user and direct session identities are preserved", async () => {
  assert.equal(await getInspectorName(null, { onlineAccessInfo: { associated_user: { first_name: "A", last_name: "Kim" } } }), "A Kim");
  assert.equal(await getInspectorName(null, { email: "staff@example.com" }), "staff@example.com");
  assert.equal(await getInspectorName(null, { userId: 123 }), "Admin #123");
});
test("only the matching current online session can restore worker identity", async () => {
  const session={id:"current",shop:"test.myshopify.com",isOnline:true};
  const db={session:{findUnique:async ({where})=>{assert.equal(where.id,"current");return {shop:session.shop,isOnline:true,firstName:"Current"};}}};
  assert.equal(await getInspectorName(null,session,{db}),"Current");
  db.session.findUnique=async()=>({shop:"other.myshopify.com",isOnline:true,firstName:"Other"});
  assert.equal(await getInspectorName(null,session,{db}),"확인되지 않은 작업자");
});
test("offline sessions never borrow another operator or store owner's name", async () => {
  const db={session:{findFirst:()=>assert.fail("must not read another login"),findUnique:()=>assert.fail("must not identify offline session")}};
  const admin={graphql:()=>assert.fail("store identity is not operator identity")};
  assert.equal(await getInspectorName(admin,{id:"offline_test",shop:"test.myshopify.com",isOnline:false},{db}),"확인되지 않은 작업자");
});
test("missing user and failed identity storage remain explicitly unverified", async () => {
  assert.equal(await getInspectorName(null,{}),"확인되지 않은 작업자");
  assert.equal(await getInspectorName(null,{id:"x",isOnline:true},{db:{session:{findUnique:async()=>{throw new Error("offline");}}}}),"확인되지 않은 작업자");
});
