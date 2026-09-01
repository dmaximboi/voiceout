import { describe, expect, it } from 'vitest';
import { handleSchema, passwordSchema, isAllowedAudioMime } from './schemas';
import { DURATION_CAPS, MAX_AUDIO_BYTES } from './constants';
import { nameChangeAvailableAt, passwordChangeAvailableAt } from './cooldowns';
import { matchesUploadMagic } from './magic';

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
});
