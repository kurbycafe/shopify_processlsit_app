import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestCoalescer } from '../app/services/requestCoalescer.js';
import { getDashboardData } from '../app/services/dashboardData.server.js';
test('maintenance shares in-flight work per shop, expires, and isolates tenants', async () => {
 let now = 0, calls = 0, release;
 const run = createRequestCoalescer({ ttlMs: 20, now: () => now });
 const work = () => { calls++; return new Promise(resolve => { release = resolve; }); };
 const first = run('shop-a', work); const second = run('shop-a', work);
 await Promise.resolve(); assert.equal(calls, 1); release(['done']);
 assert.deepEqual(await first, await second);
 await run('shop-a', () => { throw new Error('must be cached'); });
 await run('shop-b', () => { calls++; return []; }); assert.equal(calls, 2);
 now = 21; await run('shop-a', () => { calls++; return []; }); assert.equal(calls, 3);
});
test('failed and incomplete maintenance can retry; cache remains bounded', async () => {
 const run = createRequestCoalescer({ ttlMs: 100, maxEntries: 1 });
 await assert.rejects(run('a', () => { throw new Error('down'); }));
 assert.equal(await run('a', () => 'ok'), 'ok');
 await run('b', () => 'bad', () => false);
 assert.equal(await run('b', () => 'retried'), 'retried');
});
test('dashboard starts all independent reads before awaiting any result and preserves data', async () => {
 const started = []; const releases = [];
 const work = (name, value) => { started.push(name); return new Promise(resolve => releases.push(() => resolve(value))); };
 const range = { start: new Date('2026-09-14'), end: new Date('2026-09-15') };
 const result = getDashboardData({ shop: 'test.myshopify.com', admin: { graphql: () => work('shopify', { json: async () => ({ data: { ordersCount: { count: 7 } } }) }) },
   db: { inspectionRecord: { count: args => { assert.equal(args.where.shop, 'test.myshopify.com'); return work('count', 2); },
     findMany: args => work('records', args.select ? [{ status: 'SUCCESS', createdAt: range.start }] : [{ id: 'recent', items: [] }]) },
     backInStockSubscription: { count: () => work('subscriptions', 3) } },
   getUpcomingContainers: () => work('odoo', [{ id: 'incoming' }]), getTodayRange: () => range, getThisWeekRange: () => range,
   getPastDaysRange: () => [{ ...range, dateLabel: '09/14' }], getCalendarMonths: () => [] });
 assert.equal(started.length, 7);
 releases.forEach(release => release());
 const data = await result; assert.equal(data.unfulfilledCount, 7); assert.equal(data.chartData[0].successCount, 1);
 assert.equal(data.upcomingContainers[0].id, 'incoming'); assert.equal(data.recentLogs[0].id, 'recent');
});

test('schema readiness requires every existing repair column and index', async () => {
 const { readFile } = await import('node:fs/promises');
 const { schemaIsReady } = await import('../app/services/schemaReadiness.js');
 const { customerSchemaStatements, customerReactionStatements } = await import('../app/services/customerSchema.js');
 const source = await readFile(new URL('../app/db.server.js', import.meta.url), 'utf8') + '\n' + [...customerSchemaStatements,...customerReactionStatements].join(';\n') + ';';
 const entries = new Map();
 const add = (kind, tableName, name) => entries.set(`${kind}:${tableName}:${name}`, { kind, tableName, name });
 for (const [, table, columns] of source.matchAll(/CREATE TABLE IF NOT EXISTS "(\w+)" \(([\s\S]*?)\);/g)) {
   for (const [, column] of columns.matchAll(/^\s*"(\w+)"/gm)) add('column', table, column);
 }
 for (const [, table, column] of source.matchAll(/ALTER TABLE (?:IF EXISTS )?"(\w+)" ADD COLUMN IF NOT EXISTS "(\w+)"/g)) add('column', table, column);
 for (const [, index, table] of source.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS "(\w+)" ON "(\w+)"/g)) add('index', table, index);
 const rows = [...entries.values()]; assert.ok(rows.length > 50); assert.equal(schemaIsReady(rows), true);
 for (let i = 0; i < rows.length; i++) assert.equal(schemaIsReady(rows.filter((_, index) => i !== index)), false);
 assert.equal(schemaIsReady([]), false);
 for (const [tableName, name] of [['CustomerRequest', 'requestKey'], ['CustomerNotificationPreference', 'marketing'], ['InspectionItem', 'orderLineId']]) {
   assert.equal(schemaIsReady(rows.filter(row => row.tableName !== tableName || row.name !== name)), false);
 }
 assert.equal(schemaIsReady(rows.filter(row => row.name !== 'CustomerNotificationPreference_shop_customerId_key')), false);
});
