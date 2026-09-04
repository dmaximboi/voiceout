import { z } from 'zod';
import {
  AUDIO_MIMES,
  AVATAR_MIMES,
  DURATION_CAPS,
  FEED_EVENT_TYPES,
  FEED_FEEDBACK_KINDS,
  HANDLE_MAX,
  HANDLE_MIN,
  MAX_BIO_LENGTH,
  MAX_CAPTION_LENGTH,
  MAX_COMMENT_LENGTH,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_POST_IMAGES,
  POST_REACTIONS,
  PRESET_STICKERS,
  RESERVED_HANDLES,
} from './constants.js';

export const handleSchema = z
  .string()
  .min(HANDLE_MIN)
  .max(HANDLE_MAX)
  .regex(/^[a-z0-9_]+$/, 'Handle: lowercase letters, numbers, underscore')
  .refine((h) => !RESERVED_HANDLES.includes(h as (typeof RESERVED_HANDLES)[number]), {
    message: 'This handle is reserved',
  });

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128)
  .refine((p) => !p.includes(' '), { message: 'Password cannot contain spaces' });

export const registerSchema = z.object({
  email: z.string().email().max(254).transform((e) => e.toLowerCase()),
  password: passwordSchema,
  handle: handleSchema,
  displayName: z.string().trim().min(1).max(MAX_DISPLAY_NAME_LENGTH),
});

export const loginSchema = z.object({
  /** Email or @handle */
  login: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(128),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email().max(254).transform((e) => e.toLowerCase()),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const verifyEmailSchema = z.object({
  token: z.string().min(20).max(200),
});

export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(MAX_DISPLAY_NAME_LENGTH).optional(),
  bio: z.string().trim().max(MAX_BIO_LENGTH).optional(),
  handle: handleSchema.optional(),
  verificationCode: z.string().trim().regex(/^\d{6}$/).optional(),
});

export const linkEmailSchema = z.object({
  email: z.string().email().max(254).transform((e) => e.toLowerCase()),
});

export const confirmEmailSchema = z.object({
  email: z.string().email().max(254).transform((e) => e.toLowerCase()),
  code: z.string().trim().regex(/^\d{6}$/),
});

export const confirmPhoneSchema = z.object({
  phone: z
    .string()
    .trim()
    .min(7)
    .max(32)
    .regex(/^\+?[0-9\s\-()]+$/),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().max(128).optional(),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1).max(128),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const deleteAccountSchema = z.object({
  confirm: z.literal('DELETE'),
});

export const voiceSchema = z.object({
  body: z.string().trim().min(1).max(MAX_CAPTION_LENGTH),
});

export const durationCapSchema = z.custom<number>(
  (v) => typeof v === 'number' && (DURATION_CAPS as readonly number[]).includes(v),
);

export const createPostSchema = z.object({
  caption: z.string().trim().min(1).max(1000),
  mediaId: z.string().uuid(),
  imageIds: z.array(z.string().uuid()).max(MAX_POST_IMAGES).optional(),
  durationCap: z.number().refine((v) => (DURATION_CAPS as readonly number[]).includes(v)),
  durationMs: z.number().int().positive().max(30 * 60 * 1000 + 2000).optional(),
  transcript: z.string().trim().max(4000).optional(),
});

export const updatePostCaptionSchema = z.object({
  caption: z.string().trim().min(1).max(1000),
});

export const createCommentSchema = z
  .object({
    body: z.string().trim().max(1000).optional().default(''),
    mediaId: z.string().uuid().optional(),
    stickerId: z
      .enum(PRESET_STICKERS.map((s) => s.id) as [string, ...string[]])
      .optional(),
    replyToCommentId: z.string().uuid().optional(),
  })
  .refine((d) => Boolean(d.body) || Boolean(d.mediaId), { message: 'Empty reply' });

export const feedFeedbackSchema = z
  .object({
    postId: z.string().uuid(),
    kind: z.enum(FEED_FEEDBACK_KINDS),
  })
  .strict();

export const feedEventSchema = z
  .object({
    eventType: z.enum(FEED_EVENT_TYPES),
    postId: z.string().uuid().optional(),
    commentId: z.string().uuid().optional(),
    targetUserId: z.string().uuid().optional(),
    source: z.string().trim().min(1).max(32).optional(),
    dwellMs: z.number().int().min(0).max(2_000_000).optional(),
  })
  .strict()
  .refine((event) => Boolean(event.postId || event.commentId || event.targetUserId), {
    message: 'An event target is required',
  });

export const feedEventsSchema = z
  .object({
    events: z.array(feedEventSchema).min(1).max(50),
  })
  .strict();

export const listenSchema = z.object({
  postId: z.string().uuid(),
  listenedMs: z.number().int().min(0).max(2_000_000),
  durationMs: z.number().int().min(0).max(2_000_000).optional(),
});

export const reactSchema = z.object({
  type: z.enum(POST_REACTIONS),
});

export const reportSchema = z.object({
  targetType: z.enum(['post', 'comment', 'user']),
  targetId: z.string().uuid(),
  reason: z.enum(['spam', 'abuse', 'illegal', 'other']),
  details: z.string().trim().max(500).optional(),
  alsoBlock: z.boolean().optional(),
});

export const planCheckoutSchema = z.object({
  tier: z.enum(['basic', 'verified', 'gold']),
});

export const bugFeedbackSchema = z.object({
  description: z.string().trim().min(1).max(1000),
  screenshotMediaId: z.string().uuid().nullable().optional(),
});

export const moderationQueueQuerySchema = z.object({
  status: z.enum(['pending', 'resolved', 'dismissed']).optional().default('pending'),
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

export const moderationResolutionSchema = z.object({
  action: z.enum(['resolved', 'dismissed']),
  note: z.string().trim().max(1000).optional(),
});

export const suspensionSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const uploadIntentSchema = z.object({
  kind: z.enum(['post_audio', 'comment_audio', 'avatar', 'post_image']),
  mime: z.string().min(1),
  bytes: z.number().int().positive(),
  durationCap: z.number().optional(),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(64),
  cursor: z.string().optional(),
});

export function isAllowedAudioMime(mime: string): boolean {
  const base = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!base) return true; // browser sometimes omits type; magic check catches fakes
  if (AUDIO_MIMES.some((m) => m.split(';')[0] === base)) return true;
  return (
    base === 'application/ogg' ||
    base === 'video/webm' ||
    base === 'audio/m4a' ||
    base === 'audio/x-m4a' ||
    base === 'audio/mp3' ||
    base === 'application/octet-stream'
  );
}

export function isAllowedAvatarMime(mime: string): boolean {
  const base = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!base) return true;
  if ((AVATAR_MIMES as readonly string[]).includes(base)) return true;
  return base === 'image/jpg' || base === 'image/*' || base === 'application/octet-stream';
}
