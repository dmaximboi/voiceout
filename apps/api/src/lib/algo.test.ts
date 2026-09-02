import assert from 'node:assert/strict';
import test from 'node:test';
import { NEUTRAL_CLASSIFICATION, parseCommentClassification } from './algo.js';

test('classification parser safely falls back to neutral', () => {
  assert.deepEqual(parseCommentClassification({ primary: 'invented', confidence: 99 }), NEUTRAL_CLASSIFICATION);
  assert.deepEqual(parseCommentClassification(null), NEUTRAL_CLASSIFICATION);
});

test('classification parser bounds and validates fields', () => {
  assert.deepEqual(
    parseCommentClassification({ primary: 'supportive', secondary: 'happy', confidence: 1.4 }),
    { primary: 'supportive', secondary: 'happy', confidence: 1 },
  );
});
