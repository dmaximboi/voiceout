import assert from 'node:assert/strict';
import test from 'node:test';
import { diversifyGuestPosts } from './feed.js';

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
