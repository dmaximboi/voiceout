import assert from 'node:assert/strict';
import test from 'node:test';
import { diversifyGuestPosts, injectFollowerBest } from './feed.js';

test('guest feed is bounded and rotates authors', () => {
  const rows = [
    { id: 'a1', authorId: 'a' },
    { id: 'a2', authorId: 'a' },
    { id: 'b1', authorId: 'b' },
    { id: 'c1', authorId: 'c' },
  ];
  const result = diversifyGuestPosts(rows, 3);
  assert.deepEqual(result.map((row) => row.id), ['a1', 'b1', 'c1']);
  assert.equal(diversifyGuestPosts(rows, 100).length, rows.length);
});

test('follower-best posts take about one in eight slots', () => {
  const ranked = Array.from({ length: 20 }, (_, index) => `p${index}`);
  const result = injectFollowerBest(ranked, ['p5', 'p12']);
  assert.equal(result.includes('p5'), true);
  assert.equal(result.includes('p12'), true);
  assert.equal(result[3], 'p5');
});
