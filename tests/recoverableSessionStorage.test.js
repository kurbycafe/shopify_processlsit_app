import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RecoverableSessionStorage } from '../app/services/recoverableSessionStorage.js';

test('session storage recovers from a failed initial database check', async () => {
  let available = false;
  let checks = 0;
  const storage = new RecoverableSessionStorage({session: {count: async () => { checks++; if (!available) throw Error('connection failed'); }}}, {connectionRetries: 1, connectionRetryIntervalMs: 0});
  await assert.rejects(storage.ensureReady(), /temporarily unavailable/);
  available = true;
  storage.lastAttempt = 0;
  await Promise.all([storage.ensureReady(), storage.ensureReady()]);
  assert.equal(checks, 3);
});
