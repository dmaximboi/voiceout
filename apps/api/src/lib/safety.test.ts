import assert from 'node:assert/strict';
import test from 'node:test';
import { canAutoModerateRole, moderationThreshold } from './safety.js';

test('moderation thresholds warn at three and suspend at five unique reporters', () => {
  assert.deepEqual(moderationThreshold(2), { warn: false, suspend: false });
  assert.deepEqual(moderationThreshold(3), { warn: true, suspend: false });
  assert.deepEqual(moderationThreshold(4), { warn: true, suspend: false });
  assert.deepEqual(moderationThreshold(5), { warn: true, suspend: true });
});

test('duplicate reports do not advance a distinct reporter threshold', () => {
  const reporters = new Set(['a', 'a', 'b', 'b', 'c']);
  assert.deepEqual(moderationThreshold(reporters.size), { warn: true, suspend: false });
});

test('automatic report thresholds cannot suspend privileged staff roles', () => {
  assert.equal(canAutoModerateRole('user'), true);
  assert.equal(canAutoModerateRole('moderator'), false);
  assert.equal(canAutoModerateRole('admin'), false);
});
