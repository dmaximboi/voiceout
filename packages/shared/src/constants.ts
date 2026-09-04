export const DURATION_CAPS = [30, 60, 120, 300, 900, 1800] as const;
export type DurationCap = (typeof DURATION_CAPS)[number];

export const DURATION_CAP_LABELS: Record<DurationCap, string> = {
  30: '30s',
  60: '1m',
  120: '2m',
  300: '5m',
  900: '15m',
  1800: '30m',
};

/** Includes short voice-reply caps (6/10/15) used by comment_audio uploads. */
export const MAX_AUDIO_BYTES = {
  6: 40_000,
  10: 60_000,
  15: 80_000,
  30: 120_000,
  60: 220_000,
  120: 400_000,
  300: 900_000,
  900: 2_400_000,
  1800: 4_800_000,
} as const satisfies Record<DurationCap, number> & Record<6 | 10 | 15, number>;

export const MAX_AVATAR_BYTES = 2_500_000;
export const MAX_POST_IMAGE_BYTES = 3_000_000;
/** Absolute ceiling for schema validation; per-plan limits use maxPostImages(). */
export const MAX_POST_IMAGES = 20;
/** Free-tier defaults; paid limits via maxCaptionLength / maxCommentLength. */
export const MAX_CAPTION_LENGTH = 500;
export const MAX_COMMENT_LENGTH = 500;
export const MAX_BIO_LENGTH = 160;
export const MAX_DISPLAY_NAME_LENGTH = 50;
export const HANDLE_MIN = 3;
export const HANDLE_MAX = 20;
/** Handle + avatar identity lock after a change. Display name is unrestricted. */
export const HANDLE_CHANGE_MS = 3 * 24 * 60 * 60 * 1000;
/** @deprecated use HANDLE_CHANGE_MS — kept for older imports */
export const NAME_CHANGE_MS = HANDLE_CHANGE_MS;
export const PASSWORD_CHANGE_MS = 3 * 24 * 60 * 60 * 1000;
export const SHARE_CODE_MIN = 8;
export const SHARE_CODE_MAX = 12;

export const AUDIO_MIMES = [
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/ogg',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/mpeg',
] as const;

export const AVATAR_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export const POST_REACTIONS = ['like', 'love', 'haha', 'wow', 'sad', 'angry'] as const;
export type PostReaction = (typeof POST_REACTIONS)[number];

export const COMMENT_CATEGORIES = [
  'happy',
  'sad',
  'anger',
  'fear',
  'surprise',
  'neutral',
  'informative',
  'questioning',
  'supportive',
  'critical',
  'humorous',
  'agreement',
  'disagreement',
  'personal_story',
  'advice',
  'spam',
  'off_topic',
] as const;
export type CommentCategory = (typeof COMMENT_CATEGORIES)[number];

export const FEED_FEEDBACK_KINDS = ['not_interested', 'hide_author'] as const;
export type FeedFeedbackKind = (typeof FEED_FEEDBACK_KINDS)[number];

export const FEED_EVENT_TYPES = [
  'impression',
  'seen',
  'open',
  'play',
  'pause',
  'complete',
  'skip',
  'share',
  'comment',
  'react',
  'bookmark',
  'follow',
] as const;
export type FeedEventType = (typeof FEED_EVENT_TYPES)[number];

export const PRESET_STICKERS = [
  { id: 'fire', emoji: '🔥', label: 'Fire' },
  { id: 'heart', emoji: '❤️', label: 'Heart' },
  { id: 'laugh', emoji: '😂', label: 'Laugh' },
  { id: 'wow', emoji: '😮', label: 'Wow' },
  { id: 'sad', emoji: '😢', label: 'Sad' },
  { id: 'angry', emoji: '😡', label: 'Angry' },
  { id: 'clap', emoji: '👏', label: 'Clap' },
  { id: 'hundred', emoji: '💯', label: '100' },
  { id: 'think', emoji: '🤔', label: 'Think' },
  { id: 'mic', emoji: '🎤', label: 'Mic' },
  { id: 'wave', emoji: '👋', label: 'Wave' },
  { id: 'sparkles', emoji: '✨', label: 'Sparkles' },
  { id: 'skull', emoji: '💀', label: 'Skull' },
  { id: 'eyes', emoji: '👀', label: 'Eyes' },
  { id: 'pray', emoji: '🙏', label: 'Pray' },
  { id: 'flex', emoji: '💪', label: 'Flex' },
] as const;

export type StickerId = (typeof PRESET_STICKERS)[number]['id'];

export const RESERVED_HANDLES = [
  'admin',
  'api',
  'backend',
  'explore',
  'feed',
  'help',
  'login',
  'me',
  'notifications',
  'payments',
  'post',
  'privacy',
  'profile',
  'record',
  'register',
  'search',
  'settings',
  'support',
  'trending',
  'www',
] as const;

export const DURATION_PROBE_SLACK_MS = 1500;
