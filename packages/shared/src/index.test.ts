import { describe, expect, it } from 'vitest';
import {
  createCommentSchema,
  feedEventsSchema,
  feedFeedbackSchema,
  handleSchema,
  passwordSchema,
  isAllowedAudioMime,
} from './schemas';
import { COMMENT_CATEGORIES, DURATION_CAPS, MAX_AUDIO_BYTES } from './constants';
import { nameChangeAvailableAt, passwordChangeAvailableAt } from './cooldowns';
import { isPrivateAdminRequest, isPrivateHost, isPrivateIp } from './lan';
import { matchesUploadMagic, sniffUploadMime } from './magic';
import { canUseDurationCap, isPlanActive, activePlanTier } from './plan';

describe('handleSchema', () => {
  it('accepts valid handles', () => {
    expect(handleSchema.parse('max_01')).toBe('max_01');
  });
  it('rejects reserved', () => {
    expect(() => handleSchema.parse('admin')).toThrow();
  });
});

describe('passwordSchema', () => {
  it('requires at least 10 characters', () => {
    expect(() => passwordSchema.parse('')).toThrow();
    expect(() => passwordSchema.parse('short')).toThrow();
    expect(passwordSchema.parse('GoodPass12')).toBe('GoodPass12');
  });
});

describe('audio mime', () => {
  it('allows webm opus', () => {
    expect(isAllowedAudioMime('audio/webm;codecs=opus')).toBe(true);
  });
});

describe('caps', () => {
  it('has byte limits for every cap', () => {
    for (const cap of DURATION_CAPS) {
      expect(MAX_AUDIO_BYTES[cap]).toBeGreaterThan(0);
    }
  });
});

describe('plan tiers', () => {
  it('gates duration caps by tier', () => {
    expect(canUseDurationCap(60, null)).toBe(true);
    expect(canUseDurationCap(120, null)).toBe(true);
    expect(canUseDurationCap(300, null)).toBe(false);
    expect(canUseDurationCap(300, 'basic')).toBe(true);
    expect(canUseDurationCap(900, 'basic')).toBe(false);
    expect(canUseDurationCap(900, 'verified')).toBe(true);
    expect(canUseDurationCap(1800, 'gold')).toBe(true);
    expect(isPlanActive(null)).toBe(false);
    expect(isPlanActive(new Date(Date.now() + 60_000))).toBe(true);
    expect(activePlanTier('verified', new Date(Date.now() + 60_000))).toBe('verified');
    expect(activePlanTier('verified', null)).toBe(null);
  });
});

describe('private admin hosts', () => {
  it('allows loopback and LAN, rejects public hosts', () => {
    expect(isPrivateHost('localhost')).toBe(true);
    expect(isPrivateHost('192.168.1.64')).toBe(true);
    expect(isPrivateIp('10.0.0.8')).toBe(true);
    expect(isPrivateHost('voiceout.example')).toBe(false);
    expect(isPrivateAdminRequest('192.168.1.64', '')).toBe(true);
  });
});

describe('cooldowns', () => {
  it('waits 7 days from account creation until a name change', () => {
    const created = new Date('2026-01-01T00:00:00Z');
    expect(nameChangeAvailableAt(created, null).toISOString()).toBe('2026-01-08T00:00:00.000Z');
  });
  it('waits 7 days after a name change attempt', () => {
    const created = new Date('2026-01-01T00:00:00Z');
    const changed = new Date('2026-02-01T00:00:00Z');
    expect(nameChangeAvailableAt(created, changed).toISOString()).toBe('2026-02-08T00:00:00.000Z');
  });
  it('waits 3 days for password from creation then last change', () => {
    const created = new Date('2026-01-01T00:00:00Z');
    expect(passwordChangeAvailableAt(created, null).toISOString()).toBe('2026-01-04T00:00:00.000Z');
    expect(passwordChangeAvailableAt(created, new Date('2026-01-10T00:00:00Z')).toISOString()).toBe(
      '2026-01-13T00:00:00.000Z',
    );
  });
});

describe('upload magic', () => {
  it('accepts Ogg Opus and WebM headers', () => {
    const ogg = new Uint8Array(32);
    ogg.set([0x4f, 0x67, 0x67, 0x53]);
    expect(matchesUploadMagic('audio/ogg;codecs=opus', ogg)).toBe(true);
    const webm = new Uint8Array(32);
    webm.set([0x1a, 0x45, 0xdf, 0xa3]);
    expect(matchesUploadMagic('audio/webm', webm)).toBe(true);
  });
  it('rejects spoofed jpeg as audio', () => {
    const jpeg = new Uint8Array(32);
    jpeg.set([0xff, 0xd8, 0xff, 0xe0]);
    expect(matchesUploadMagic('audio/ogg', jpeg)).toBe(false);
    expect(matchesUploadMagic('image/jpeg', jpeg)).toBe(true);
  });
  it('sniffs blank mime from magic', () => {
    const jpeg = new Uint8Array(32);
    jpeg.set([0xff, 0xd8, 0xff, 0xe0]);
    expect(sniffUploadMime(jpeg)).toBe('image/jpeg');
  });
});

describe('phase 2 signal schemas', () => {
  it('exposes the complete comment category allowlist', () => {
    expect(COMMENT_CATEGORIES).toContain('supportive');
    expect(COMMENT_CATEGORIES).toContain('personal_story');
    expect(COMMENT_CATEGORIES).toContain('off_topic');
    expect(COMMENT_CATEGORIES).toHaveLength(17);
  });

  it('accepts a reply target on comments', () => {
    const replyToCommentId = '00000000-0000-4000-8000-000000000001';
    expect(createCommentSchema.parse({ body: 'Reply', replyToCommentId }).replyToCommentId).toBe(
      replyToCommentId,
    );
  });

  it('only accepts strict feedback kinds', () => {
    const postId = '00000000-0000-4000-8000-000000000001';
    expect(feedFeedbackSchema.parse({ postId, kind: 'not_interested' })).toEqual({
      postId,
      kind: 'not_interested',
    });
    expect(() => feedFeedbackSchema.parse({ postId, kind: 'block' })).toThrow();
    expect(() => feedFeedbackSchema.parse({ postId, kind: 'hide_author', extra: true })).toThrow();
  });

  it('bounds and strictly validates feed event batches', () => {
    const postId = '00000000-0000-4000-8000-000000000001';
    expect(feedEventsSchema.parse({ events: [{ eventType: 'impression', postId }] }).events).toHaveLength(1);
    expect(() => feedEventsSchema.parse({ events: [{ eventType: 'unknown', postId }] })).toThrow();
    expect(() => feedEventsSchema.parse({ events: [{ eventType: 'seen' }] })).toThrow();
    expect(() =>
      feedEventsSchema.parse({
        events: Array.from({ length: 51 }, () => ({ eventType: 'seen', postId })),
      }),
    ).toThrow();
  });
});
