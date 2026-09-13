import test from 'node:test';
import assert from 'node:assert/strict';
import { changeContainerStatus } from '../app/services/containerStatus.server.js';
function fixture(initial = 'ARRIVED') {
 let row = { id: 'c1', status: initial, items: [{ sku: 'A', expectedQty: 2 }], receivedAt: null };
 let writes = 0, notifications = 0;
 const tx = { $executeRaw: async () => {}, container: { findUnique: async () => row, update: async ({ data }) => { writes++; row = { ...row, ...data }; return row; } } };
 return { args: { db: { $transaction: callback => callback(tx) }, shop: 'test.myshopify.com', containerRef: 'PO1', status: 'RECEIVED', notify: async () => { notifications++; } }, counts: () => ({ writes, notifications }), row: () => row };
}
test('receipt retry preserves receivedAt and never sends a second notification', async () => {
 const f = fixture(); const first = await changeContainerStatus(f.args); const second = await changeContainerStatus(f.args);
 assert.equal(first.success, true); assert.equal(second.receivedAt, first.receivedAt); assert.deepEqual(f.counts(), { writes: 1, notifications: 1 });
});
test('invalid and backward states do not write or notify', async () => {
 const f = fixture('RECEIVED');
 assert.ok((await changeContainerStatus({ ...f.args, status: 'arbitrary' })).error);
 assert.ok((await changeContainerStatus({ ...f.args, status: 'ARRIVED' })).error);
 assert.deepEqual(f.counts(), { writes: 0, notifications: 0 });
});
test('notification failure does not falsely report failed receipt persistence', async () => {
 const f = fixture(); const result = await changeContainerStatus({ ...f.args, notify: async () => { throw new Error('down'); } });
 assert.equal(result.success, true); assert.equal(result.status, 'RECEIVED'); assert.ok(result.warning); assert.equal(f.row().status, 'RECEIVED');
});
