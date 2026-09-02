import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildReportPayload,
  canViewModeration,
  hasUnreadNotifications,
  notificationReadPayload,
  restoreRemovedPosts,
} from './safetyState.js';

test('unread indicator only appears for positive finite counts', () => {
  assert.equal(hasUnreadNotifications(1), true);
  assert.equal(hasUnreadNotifications(0), false);
  assert.equal(hasUnreadNotifications(-1), false);
  assert.equal(hasUnreadNotifications(Number.NaN), false);
});

test('mark-read payload deduplicates explicit ids and otherwise marks all', () => {
  assert.deepEqual(notificationReadPayload(['a', 'a', 'b']), { ids: ['a', 'b'] });
  assert.deepEqual(notificationReadPayload([]), { all: true });
  assert.deepEqual(notificationReadPayload(), { all: true });
});

test('moderation UI is visible only to moderators and administrators', () => {
  assert.equal(canViewModeration('user'), false);
  assert.equal(canViewModeration('moderator'), true);
  assert.equal(canViewModeration('admin'), true);
});

test('report payload trims details and omits an empty optional field', () => {
  assert.deepEqual(buildReportPayload('post', 'post-id', 'abuse', '  context  '), {
    targetType: 'post',
    targetId: 'post-id',
    reason: 'abuse',
    details: 'context',
  });
  assert.deepEqual(buildReportPayload('user', 'user-id', 'spam', '   '), {
    targetType: 'user',
    targetId: 'user-id',
    reason: 'spam',
  });
});

test('feedback undo restores original positions without duplicating posts', () => {
  const a = { id: 'a' };
  const b = { id: 'b' };
  const c = { id: 'c' };
  assert.deepEqual(restoreRemovedPosts([c], [{ post: b, index: 1 }, { post: a, index: 0 }]), [a, b, c]);
  assert.deepEqual(restoreRemovedPosts([a, c], [{ post: a, index: 0 }]), [a, c]);
});
