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

test('schema readiness requires every table, column and index of the Prisma schema', async () => {
 const { schemaIsReady, pendingSchemaStatements, schemaStatements } = await import('../app/services/schemaReadiness.js');
 const entries = new Map();
 const add = (kind, tableName, name) => entries.set(`${kind}:${tableName}:${name}`, { kind, tableName, name });
 for (const statement of schemaStatements) {
   if (statement.kind === 'table') {
     const [, columns] = /^CREATE TABLE IF NOT EXISTS "\w+" \(([\s\S]*)\)$/.exec(statement.sql);
     for (const [, column] of columns.matchAll(/^\s*"(\w+)"/gm)) add('column', statement.table, column);
   } else add(statement.kind, statement.table, statement.name);
 }
 const rows = [...entries.values()]; assert.ok(rows.length > 200); assert.equal(schemaIsReady(rows), true);
 const primaryKeys = new Set(['id', 'key']);
 for (let i = 0; i < rows.length; i++) {
   if (rows[i].kind === 'column' && primaryKeys.has(rows[i].name)) continue;
   const pending = pendingSchemaStatements(rows.filter((_, index) => i !== index));
   assert.deepEqual(pending.map(statement => `${statement.kind}:${statement.table}:${statement.name}`), [`${rows[i].kind}:${rows[i].tableName}:${rows[i].name}`]);
 }
 assert.equal(schemaIsReady([]), false);
 assert.equal(pendingSchemaStatements([]).length, schemaStatements.length);
 for (const table of ['session', 'InspectionRecord', 'Container', 'BackInStockSubscription', 'CustomerRequest', 'MobileBanner', 'AppUsageLog', 'ApiRateLimit', 'Recipe']) {
   assert.deepEqual(pendingSchemaStatements(rows.filter(row => row.tableName !== table)).filter(statement => statement.kind === 'table').map(statement => statement.table), [table]);
 }
 for (const [tableName, name] of [['CustomerRequest', 'requestKey'], ['CustomerNotificationPreference', 'marketing'], ['InspectionItem', 'orderLineId'], ['Container', 'arrivalKind']]) {
   assert.equal(schemaIsReady(rows.filter(row => row.tableName !== tableName || row.name !== name)), false);
 }
 assert.equal(schemaIsReady(rows.filter(row => row.name !== 'CustomerNotificationPreference_shop_customerId_key')), false);
});

test('schema repair runs only missing statements and is additive', async () => {
 const { applySchemaStatements, schemaStatements } = await import('../app/services/schemaReadiness.js');
 for (const statement of schemaStatements) {
   assert.match(statement.sql, /^(CREATE TABLE IF NOT EXISTS|ALTER TABLE "\w+" ADD COLUMN IF NOT EXISTS|CREATE (UNIQUE )?INDEX IF NOT EXISTS) /);
   assert.doesNotMatch(statement.sql.replaceAll('ON DELETE CASCADE ON UPDATE CASCADE', ''), /\b(DROP|DELETE|TRUNCATE|UPDATE|RENAME)\b/);
   // A column added to a populated table may only be NOT NULL when it carries a default.
   if (statement.kind === 'column' && /NOT NULL/.test(statement.sql)) assert.match(statement.sql, /DEFAULT/);
 }
 const executed = [];
 const rows = [{ kind: 'column', tableName: 'Recipe', name: 'id' }];
 const failing = { $executeRawUnsafe: async sql => { executed.push(sql); if (sql.includes('"Recipe_shop_idx"')) throw new Error('boom'); return 0; } };
 await assert.rejects(applySchemaStatements(failing, rows), /boom/);
 assert.equal(executed.some(sql => sql.startsWith('CREATE TABLE IF NOT EXISTS "Recipe"')), false);
 executed.length = 0;
 const warned = [];
 const result = await applySchemaStatements(failing, rows, { onError: (_error, statement) => warned.push(statement.name) });
 assert.deepEqual(warned, ['Recipe_shop_idx']); assert.deepEqual(result.failed.map(statement => statement.name), ['Recipe_shop_idx']);
 assert.equal(result.applied, executed.length - 1);
});

test('generated schema statements and baseline migration match prisma/schema.prisma', async () => {
 const { execFileSync } = await import('node:child_process');
 const { fileURLToPath } = await import('node:url');
 execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/generate-schema-sql.mjs', import.meta.url)), '--check'], { stdio: 'pipe' });
});

test('dashboard excludes uninspected PENDING rows from productivity chart and correctly sums actual inspections', async () => {
  const range = { start: new Date('2026-11-05T00:00:00Z'), end: new Date('2026-11-05T23:59:59Z') };
  const mockRecords = [
    { status: 'SUCCESS', completedAt: new Date('2026-11-05T10:00:00Z') },
    { status: 'ISSUE_REPORTED', completedAt: new Date('2026-11-05T12:00:00Z') },
    { status: 'PENDING', createdAt: new Date('2026-11-05T08:00:00Z') }, // Must be excluded
  ];

  const data = await getDashboardData({
    shop: 'test.myshopify.com',
    admin: { graphql: () => Promise.resolve({ json: async () => ({ data: { ordersCount: { count: 0 } } }) }) },
    db: {
      inspectionRecord: {
        count: () => Promise.resolve(0),
        findMany: (args) => {
          if (args.select) {
            return Promise.resolve(mockRecords);
          }
          return Promise.resolve([]);
        },
      },
      backInStockSubscription: { count: () => Promise.resolve(0) },
    },
    getUpcomingContainers: () => Promise.resolve([]),
    getTodayRange: () => range,
    getThisWeekRange: () => range,
    getPastDaysRange: () => [{ ...range, dateLabel: '11/05' }],
    getCalendarMonths: () => [],
  });

  assert.equal(data.chartData[0].successCount, 1);
  assert.equal(data.chartData[0].issueCount, 1);
  assert.equal(data.chartData[0].partialCount, 0);
  assert.equal(data.chartData[0].totalCount, 2); // Only 2 inspected, PENDING omitted
});
