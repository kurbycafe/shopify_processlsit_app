import test from 'node:test';
import assert from 'node:assert/strict';
import { appendSupportMessage, customerSupportMessage, updateSupportInternal } from '../app/services/customerConversation.server.js';
import { customerRequestHistory } from '../app/services/customerCommunity.server.js';

const shop = 'demo.myshopify.com', customer = 'gid://shopify/Customer/1';
function fixture() {
  const row = { id: 'req1', shop, type: 'SUPPORT', customerId: customer, status: 'REVIEWING', updatedAt: new Date('2026-01-01T00:00:00Z'), payload: { message: '도움이 필요해요', reply: '이전 답변', repliedAt: '2026-01-01T00:00:00Z' } };
  let conflicts = 0;
  const db = { customerRequest: {
    findFirst: async ({where}) => { if (where.id !== row.id || where.shop !== row.shop || (where.customerId && where.customerId !== row.customerId)) return null; return structuredClone(row); },
    updateMany: async ({where, data}) => { if (conflicts > 0) { conflicts--; row.updatedAt = new Date(row.updatedAt.getTime() + 1); return {count:0}; } if (where.updatedAt.getTime() !== row.updatedAt.getTime()) return {count:0}; Object.assign(row, data); row.updatedAt = new Date(row.updatedAt.getTime() + 1); return {count:1}; },
    findMany: async () => [structuredClone(row)], count: async () => 0,
  }};
  return {db, row, conflict: () => {conflicts++;}};
}
test('customer messages are scoped to owner and preserve legacy reply on follow-up', async () => {
 const {db,row,conflict}=fixture(); conflict();
 const request = new Request('https://example.test', {headers:{authorization:'Bearer token'}});
 await assert.rejects(customerSupportMessage({db,shop,request,verify:async()=> 'gid://shopify/Customer/2',input:{requestId:'req1',text:'다른 계정',messageId:'id-1'}}), {status:404});
 const args={db,shop,request,verify:async()=>customer,input:{requestId:'req1',text:'추가 문의',messageId:'id-1'}};
 await customerSupportMessage(args);
 assert.equal(row.status, 'REQUESTED'); assert.equal(row.payload.conversation.length,2); assert.equal(row.payload.conversation[0].text,'이전 답변');
 const duplicate=await customerSupportMessage(args); assert.equal(duplicate.duplicate,true); assert.equal(row.payload.conversation.length,2);
 await assert.rejects(customerSupportMessage({...args,input:{...args.input,text:'변경'}}),{status:409});
});
test('manager notes never appear in customer request history and messages remain visible', async () => {
 const {db,row}=fixture();
 await updateSupportInternal({db,shop,requestId:'req1',note:'관리자 전용 내용',assignee:'담당자'});
 assert.equal(row.payload.supportInternal.note,'관리자 전용 내용');
 const response=await customerRequestHistory({db,shop,request:new Request('https://example.test'),verify:async()=>customer});
 assert.equal(response.requests[0].payload.supportInternal, undefined);
 assert.equal(response.requests[0].payload.message, '도움이 필요해요');
});
test('admin replies preserve prior conversation and current legacy reply field', async () => {
 const {db,row}=fixture();
 await appendSupportMessage({db,shop,requestId:'req1',sender:'admin',text:'새 답변',messageId:'message-2'});
 assert.equal(row.payload.reply,'새 답변'); assert.equal(row.payload.conversation.length,2); assert.equal(row.status,'REVIEWING');
});

 test('unlinked guest inquiries cannot be falsely sent an in-app reply', async () => {
  const {db,row}=fixture(); row.customerId=null;
  await assert.rejects(appendSupportMessage({db,shop,requestId:'req1',sender:'admin',text:'답변',messageId:'message-3'}), {status:409,code:'CUSTOMER_NOT_LINKED'});
  assert.equal(row.payload.conversation, undefined);
 });
