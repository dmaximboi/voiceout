import assert from 'node:assert/strict';
import test from 'node:test';
import { notificationReadSchema } from './notifications.js';

const id = '123e4567-e89b-12d3-a456-426614174000';

test('notification read request requires one intentional operation', () => {
  assert.deepEqual(notificationReadSchema.parse({ all: true }), { all: true });
  assert.deepEqual(notificationReadSchema.parse({ ids: [id] }), { ids: [id] });
  assert.equal(notificationReadSchema.safeParse({}).success, false);
  assert.equal(notificationReadSchema.safeParse({ all: true, ids: [id] }).success, false);
  assert.equal(notificationReadSchema.safeParse({ all: false }).success, false);
});

test('notification read request rejects invalid or empty ids', () => {
  assert.equal(notificationReadSchema.safeParse({ ids: [] }).success, false);
  assert.equal(notificationReadSchema.safeParse({ ids: ['not-a-uuid'] }).success, false);
});
