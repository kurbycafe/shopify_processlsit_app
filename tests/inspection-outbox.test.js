import test from "node:test";
import assert from "node:assert/strict";
import { updateInspectionOutbox, drainInspectionOutbox } from "../app/services/inspectionPushOutbox.server.js";

const shop = "test.myshopify.com", orderId = "gid://shopify/Order/123", customerId = "gid://shopify/Customer/42";
const done = [{ id: "line1", orderedQuantity: 2, inspectedQuantity: 2 }];
function memory() {
  const rows = [];
  let n = 0;
  const matches = (r, w) => Object.entries(w).every(([k,v]) => k === 'payload' ? r.payload?.[v.path[0]] === v.equals : r[k] === v);
  const db = {
    rows,
    $executeRaw: async () => {},
    $transaction: async fn => fn(db),
    customerNotificationPreference: { findUnique: async () => ({ pushEnabled: true, orderUpdates: true }) },
    customerRequest: {
      findUnique: async ({where}) => rows.find(r => matches(r,where)) || null,
      findMany: async ({where}) => rows.filter(r => matches(r,where)),
      upsert: async ({where,create,update}) => { let r=rows.find(row=>matches(row,where)); if (r) Object.assign(r,update); else { r={id:`row${++n}`,...create}; rows.push(r); } return r; },
      updateMany: async ({where,data}) => { const found=rows.filter(r=>matches(r,where)); found.forEach(r=>Object.assign(r,data)); return {count:found.length}; },
    },
  }; return db;
}
const update=(db,status,items=done)=>updateInspectionOutbox(db,{shop,orderId,orderName:'#123',status,items});
const admin={graphql:async()=>({json:async()=>({data:{order:{id:orderId,name:'#123',customer:{id:customerId}}}})})};

test('retries failed lookup, queues one private notification and avoids duplicates', async()=>{
 const db=memory(); await update(db,'SUCCESS'); const row=db.rows[0], first=row.payload.eventId;
 assert.equal(row.status,'PENDING');
 await drainInspectionOutbox({db,shop,admin:{graphql:async()=>{throw Error('offline');}}});
 assert.equal(row.status,'PENDING');
 assert.equal((await drainInspectionOutbox({db,shop,admin})).length,1);
 assert.equal(row.status,'QUEUED');
 await update(db,'SUCCESS'); assert.equal(row.payload.eventId,first);
 assert.equal((await drainInspectionOutbox({db,shop,admin})).length,0);
 const messages=db.rows.filter(r=>r.type==='MOBILE_NOTIFICATION');
 assert.equal(messages.length,1); assert.equal(messages[0].customerId,customerId);
 assert.equal(messages[0].payload.target.section,'inspection');
 assert.match(messages[0].payload.translations.de.title,/Qualitätsprüfung/);
 assert.match(messages[0].payload.translations.en.title,/inspection/i);
});

test('reopening invalidates prior event and a new completion receives a new event', async()=>{
 const db=memory(); await update(db,'SUCCESS'); await drainInspectionOutbox({db,shop,admin});
 const outbox=db.rows.find(r=>r.type==='INSPECTION_PUSH_OUTBOX'), message=db.rows.find(r=>r.type==='MOBILE_NOTIFICATION');
 const first=outbox.payload.eventId;
 await update(db,'PARTIAL',[{...done[0],inspectedQuantity:1}]);
 assert.equal(outbox.status,'CANCELLED'); assert.equal(message.status,'DELETED');
 await update(db,'SUCCESS'); assert.equal(outbox.status,'PENDING'); assert.notEqual(outbox.payload.eventId,first);
 await drainInspectionOutbox({db,shop,admin}); assert.equal(db.rows.filter(r=>r.type==='MOBILE_NOTIFICATION').length,2);
});

test('inspection changed during customer lookup cannot enqueue stale notification', async()=>{
 const db=memory(); await update(db,'SUCCESS');
 const delayed={graphql:async()=>{await update(db,'PARTIAL',[{...done[0],inspectedQuantity:1}]);return admin.graphql();}};
 assert.deepEqual(await drainInspectionOutbox({db,shop,admin:delayed}),[]);
 assert.equal(db.rows.filter(r=>r.type==='MOBILE_NOTIFICATION').length,0);
});
