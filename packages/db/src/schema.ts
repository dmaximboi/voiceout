import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const oauthProviderEnum = pgEnum('oauth_provider', ['google', 'apple', 'github', 'tiktok', 'telegram']);
export const mediaKindEnum = pgEnum('media_kind', ['avatar', 'post_audio', 'comment_audio', 'post_image']);
export const mediaStatusEnum = pgEnum('media_status', ['pending', 'ready', 'rejected']);
export const postStatusEnum = pgEnum('post_status', ['pending', 'published', 'rejected']);
export const reactionEnum = pgEnum('reaction_type', [
  'like',
  'love',
  'haha',
  'wow',
  'sad',
  'angry',
]);
export const notificationTypeEnum = pgEnum('notification_type', [
  'follow',
  'comment',
  'reaction',
  'comment_like',
  'follow_post',
  'trending',
  'account_warning',
]);
export const reportTargetEnum = pgEnum('report_target', ['post', 'comment', 'user']);
export const reportReasonEnum = pgEnum('report_reason', ['spam', 'abuse', 'illegal', 'other']);
export const moderationStatusEnum = pgEnum('moderation_status', ['pending', 'resolved', 'dismissed']);
export const userRoleEnum = pgEnum('user_role', ['user', 'moderator', 'admin']);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 254 }).notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    passwordHash: text('password_hash'),
    handle: varchar('handle', { length: 20 }).notNull(),
    displayName: varchar('display_name', { length: 50 }).notNull(),
    bio: varchar('bio', { length: 160 }),
    avatarMediaId: uuid('avatar_media_id'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    role: userRoleEnum('role').notNull().default('user'),
    warningCount: integer('warning_count').notNull().default(0),
    warnedAt: timestamp('warned_at', { withTimezone: true }),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    suspensionReason: varchar('suspension_reason', { length: 500 }),
    suspendedBy: uuid('suspended_by').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
    profileNameChangedAt: timestamp('profile_name_changed_at', { withTimezone: true }),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
    studioUntil: timestamp('studio_until', { withTimezone: true }),
    adminDeviceHash: varchar('admin_device_hash', { length: 64 }),
    phone: varchar('phone', { length: 32 }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    erasedAt: timestamp('erased_at', { withTimezone: true }),
    emailHmac: varchar('email_hmac', { length: 64 }),
    emailCt: text('email_ct'),
    emailNonce: text('email_nonce'),
    lang: varchar('lang', { length: 8 }),
    region: varchar('region', { length: 8 }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('users_email_idx').on(t.email),
    uniqueIndex('users_handle_idx').on(t.handle),
    uniqueIndex('users_email_hmac_idx').on(t.emailHmac),
    index('users_suspended_idx').on(t.suspendedAt).where(sql`${t.suspendedAt} is not null`),
    index('users_warning_count_idx').on(t.warningCount).where(sql`${t.warningCount} > 0`),
    uniqueIndex('users_phone_idx').on(t.phone).where(sql`${t.phone} is not null`),
    check('users_warning_count_check', sql`${t.warningCount} >= 0`),
  ],
);

export const userKeys = pgTable('user_keys', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'restrict' }),
  wrappedDek: text('wrapped_dek').notNull(),
  wrapNonce: text('wrap_nonce').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const oauthAccounts = pgTable(
  'oauth_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: oauthProviderEnum('provider').notNull(),
    providerAccountId: varchar('provider_account_id', { length: 255 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('oauth_provider_account_idx').on(t.provider, t.providerAccountId)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    userAgent: text('user_agent'),
    ip: varchar('ip', { length: 64 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const follows = pgTable(
  'follows',
  {
    followerId: uuid('follower_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    followeeId: uuid('followee_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    notifyPosts: boolean('notify_posts').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.followerId, t.followeeId] }),
    index('follows_followee_idx').on(t.followeeId),
  ],
);

export const blocks = pgTable(
  'blocks',
  {
    blockerId: uuid('blocker_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    blockedId: uuid('blocked_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] }), index('blocks_blocked_idx').on(t.blockedId)],
);

export const mutes = pgTable(
  'mutes',
  {
    muterId: uuid('muter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mutedId: uuid('muted_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.muterId, t.mutedId] }), index('mutes_muted_idx').on(t.mutedId)],
);

export const mediaObjects = pgTable(
  'media_objects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    objectKey: text('object_key').notNull(),
    kind: mediaKindEnum('kind').notNull(),
    mime: varchar('mime', { length: 120 }).notNull(),
    bytes: bigint('bytes', { mode: 'number' }).notNull(),
    durationMs: integer('duration_ms'),
    durationCap: integer('duration_cap'),
    sha256: varchar('sha256', { length: 64 }),
    status: mediaStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('media_object_key_idx').on(t.objectKey), index('media_user_idx').on(t.userId)],
);

export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    caption: varchar('caption', { length: 500 }).notNull(),
    transcript: text('transcript'),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => mediaObjects.id),
    imageIds: uuid('image_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    durationMs: integer('duration_ms').notNull(),
    durationCap: integer('duration_cap').notNull(),
    status: postStatusEnum('status').notNull().default('pending'),
    lang: varchar('lang', { length: 8 }),
    commentEmotion: varchar('comment_emotion', { length: 16 }),
    commentCategories: jsonb('comment_categories')
      .$type<Record<string, number>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    region: varchar('region', { length: 8 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('posts_author_created_idx').on(t.authorId, t.createdAt),
    index('posts_status_created_idx').on(t.status, t.createdAt),
  ],
);

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: varchar('body', { length: 500 }).notNull(),
    mediaId: uuid('media_id').references(() => mediaObjects.id),
    stickerId: varchar('sticker_id', { length: 32 }),
    category: varchar('category', { length: 32 }).notNull().default('neutral'),
    secondaryCategory: varchar('secondary_category', { length: 32 }),
    categoryConfidence: real('category_confidence'),
    replyToCommentId: uuid('reply_to_comment_id').references((): AnyPgColumn => comments.id, {
      onDelete: 'set null',
    }),
    replyToUserId: uuid('reply_to_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('comments_post_idx').on(t.postId, t.createdAt),
    index('comments_author_idx').on(t.authorId, t.createdAt),
    index('comments_category_idx').on(t.category, t.createdAt),
    index('comments_secondary_category_idx').on(t.secondaryCategory, t.createdAt),
    index('comments_reply_idx').on(t.replyToCommentId, t.createdAt),
    check(
      'comments_category_check',
      sql`${t.category} in ('happy', 'sad', 'anger', 'fear', 'surprise', 'neutral', 'informative', 'questioning', 'supportive', 'critical', 'humorous', 'agreement', 'disagreement', 'personal_story', 'advice', 'spam', 'off_topic')`,
    ),
    check(
      'comments_secondary_category_check',
      sql`${t.secondaryCategory} is null or ${t.secondaryCategory} in ('happy', 'sad', 'anger', 'fear', 'surprise', 'neutral', 'informative', 'questioning', 'supportive', 'critical', 'humorous', 'agreement', 'disagreement', 'personal_story', 'advice', 'spam', 'off_topic')`,
    ),
    check(
      'comments_category_confidence_check',
      sql`${t.categoryConfidence} is null or ${t.categoryConfidence} between 0 and 1`,
    ),
  ],
);

export const searchQueries = pgTable(
  'search_queries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    query: varchar('query', { length: 64 }).notNull(),
    scope: varchar('scope', { length: 8 }).notNull(),
    resultCount: integer('result_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('search_queries_user_created_idx').on(t.userId, t.createdAt),
    index('search_queries_user_query_idx').on(t.userId, t.query),
    check('search_queries_scope_check', sql`${t.scope} in ('users', 'posts', 'all')`),
    check('search_queries_result_count_check', sql`${t.resultCount} >= 0`),
  ],
);

export const feedFeedback = pgTable(
  'feed_feedback',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 24 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.postId, t.kind] }),
    index('feed_feedback_user_kind_idx').on(t.userId, t.kind, t.createdAt),
    index('feed_feedback_user_author_idx').on(t.userId, t.authorId, t.createdAt),
    uniqueIndex('feed_feedback_hide_author_unique_idx')
      .on(t.userId, t.authorId)
      .where(sql`${t.kind} = 'hide_author'`),
    check('feed_feedback_kind_check', sql`${t.kind} in ('not_interested', 'hide_author')`),
    check('feed_feedback_not_self_check', sql`${t.userId} <> ${t.authorId}`),
  ],
);

export const userEvents = pgTable(
  'user_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventType: varchar('event_type', { length: 24 }).notNull(),
    postId: uuid('post_id').references(() => posts.id, { onDelete: 'cascade' }),
    commentId: uuid('comment_id').references(() => comments.id, { onDelete: 'cascade' }),
    targetUserId: uuid('target_user_id').references(() => users.id, { onDelete: 'set null' }),
    source: varchar('source', { length: 32 }),
    dwellMs: integer('dwell_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('user_events_user_created_idx').on(t.userId, t.createdAt),
    index('user_events_post_type_idx').on(t.postId, t.eventType, t.createdAt),
    index('user_events_target_user_idx').on(t.targetUserId, t.eventType, t.createdAt),
    check(
      'user_events_type_check',
      sql`${t.eventType} in ('impression', 'seen', 'open', 'play', 'pause', 'complete', 'skip', 'share', 'comment', 'react', 'bookmark', 'follow')`,
    ),
    check('user_events_dwell_check', sql`${t.dwellMs} is null or ${t.dwellMs} between 0 and 2000000`),
    check(
      'user_events_target_check',
      sql`${t.postId} is not null or ${t.commentId} is not null or ${t.targetUserId} is not null`,
    ),
  ],
);

export const postReactions = pgTable(
  'post_reactions',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: reactionEnum('type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.userId] }),
    index('post_reactions_type_idx').on(t.postId, t.type),
  ],
);

export const commentLikes = pgTable(
  'comment_likes',
  {
    commentId: uuid('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.commentId, t.userId] })],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: notificationTypeEnum('type').notNull(),
    message: varchar('message', { length: 500 }),
    postId: uuid('post_id').references(() => posts.id, { onDelete: 'cascade' }),
    commentId: uuid('comment_id').references(() => comments.id, { onDelete: 'cascade' }),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notifications_user_idx').on(t.userId, t.createdAt),
    index('notifications_unread_user_idx')
      .on(t.userId)
      .where(sql`${t.readAt} is null`),
  ],
);

export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reporterId: uuid('reporter_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    targetType: reportTargetEnum('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    subjectUserId: uuid('subject_user_id').references(() => users.id, { onDelete: 'cascade' }),
    reason: reportReasonEnum('reason').notNull(),
    details: varchar('details', { length: 500 }),
    status: moderationStatusEnum('status').notNull().default('pending'),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionNote: varchar('resolution_note', { length: 1000 }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('reports_pending_target_reporter_idx')
      .on(t.reporterId, t.targetType, t.targetId)
      .where(sql`${t.status} = 'pending'`),
    index('reports_queue_idx').on(t.status, t.createdAt),
    index('reports_subject_pending_idx').on(t.subjectUserId, t.reporterId).where(sql`${t.status} = 'pending'`),
    check('reports_not_self_check', sql`${t.subjectUserId} is null or ${t.reporterId} <> ${t.subjectUserId}`),
  ],
);

export const bugFeedback = pgTable(
  'bug_feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    description: varchar('description', { length: 1000 }).notNull(),
    screenshotMediaId: uuid('screenshot_media_id').references(() => mediaObjects.id, { onDelete: 'set null' }),
    status: moderationStatusEnum('status').notNull().default('pending'),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionNote: varchar('resolution_note', { length: 1000 }),
    ...timestamps,
  },
  (t) => [
    index('bug_feedback_user_idx').on(t.userId, t.createdAt),
    index('bug_feedback_queue_idx').on(t.status, t.createdAt),
    check('bug_feedback_description_check', sql`length(${t.description}) between 1 and 1000`),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: varchar('action', { length: 64 }).notNull(),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    ip: varchar('ip', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_action_idx').on(t.action, t.createdAt)],
);

export const seenPosts = pgTable(
  'seen_posts',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    seenAt: timestamp('seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.postId] })],
);

export const trendingSnapshots = pgTable('trending_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  postIds: jsonb('post_ids').$type<string[]>().notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
});

export const listenEvents = pgTable(
  'listen_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    listenedMs: integer('listened_ms').notNull(),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [    index('listen_events_user_idx').on(t.userId, t.createdAt),
    index('listen_events_post_idx').on(t.postId),
    index('listen_events_user_post_idx').on(t.userId, t.postId),
  ],
);

export const shareClicks = pgTable(
  'share_clicks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    sharerId: uuid('sharer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    clickerId: uuid('clicker_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('share_clicks_unique_idx').on(t.postId, t.sharerId, t.clickerId),
    index('share_clicks_sharer_idx').on(t.sharerId, t.createdAt),
    index('share_clicks_clicker_idx').on(t.clickerId, t.createdAt),
  ],
);

export const bookmarks = pgTable(
  'bookmarks',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.postId] }), index('bookmarks_user_idx').on(t.userId, t.createdAt)],
);

export const reposts = pgTable(
  'reposts',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.postId] }), index('reposts_post_idx').on(t.postId, t.createdAt)],
);

export const voices = pgTable(
  'voices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    body: varchar('body', { length: 500 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('voices_user_post_idx').on(t.userId, t.postId),
    index('voices_post_idx').on(t.postId, t.createdAt),
  ],
);

export const billingCheckouts = pgTable(
  'billing_checkouts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 32 }).notNull().default('bachs'),
    checkoutId: varchar('checkout_id', { length: 128 }).notNull(),
    status: varchar('status', { length: 32 }).notNull().default('open'),
    purpose: varchar('purpose', { length: 32 }).notNull().default('studio'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('billing_checkouts_checkout_id_idx').on(t.checkoutId),
    index('billing_checkouts_user_idx').on(t.userId, t.createdAt),
  ],
);

export const billingWebhookEvents = pgTable('billing_webhook_events', {
  eventId: varchar('event_id', { length: 128 }).primaryKey(),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
});
