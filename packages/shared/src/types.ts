import type {
  CommentCategory,
  DurationCap,
  FeedEventType,
  FeedFeedbackKind,
  PostReaction,
  StickerId,
} from './constants.js';
import type { PlanBadge, PlanTier } from './plan.js';

export type PublicUser = {
  id: string;
  handle: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  followerCount: number;
  followingCount: number;
  createdAt: string;
  planBadge: PlanBadge;
  nameAccent: boolean;
};

export type MeUser = PublicUser & {
  email: string;
  emailVerifiedAt: string | null;
  isEmailVerified: boolean;
  needsRealEmail: boolean;
  phone: string | null;
  role: 'user' | 'moderator' | 'admin';
  hasPassword: boolean;
  planTier: PlanTier | null;
  planUntil: string | null;
  /** @deprecated use planTier */
  isStudio: boolean;
  /** @deprecated use planUntil */
  studioUntil: string | null;
  nameChangeAvailableAt: string;
  avatarChangeAvailableAt: string;
  passwordChangeAvailableAt: string;
};

export type PostCard = {
  id: string;
  shareCode: string;
  author: PublicUser;
  caption: string;
  durationMs: number;
  durationCap: DurationCap;
  audioUrl: string | null;
  imageUrls: string[];
  videoUrl: string | null;
  createdAt: string;
  reactionCounts: Record<PostReaction, number>;
  myReaction: PostReaction | null;
  commentCount: number;
  bookmarkCount: number;
  repostCount: number;
  voiceCount: number;
  bookmarkedByMe: boolean;
  repostedByMe: boolean;
  voicedByMe: boolean;
  status: 'pending' | 'published' | 'rejected';
  categories: Partial<Record<CommentCategory, number>>;
  rankReasons: string[];
};

export type FeedItem = {
  id: string;
  type: 'post' | 'repost' | 'voice';
  createdAt: string;
  actor: PublicUser | null;
  body: string | null;
  post: PostCard;
};

export type CommentCard = {
  id: string;
  author: PublicUser;
  body: string;
  stickerId: StickerId | null;
  durationMs: number | null;
  audioUrl: string | null;
  likeCount: number;
  likedByMe: boolean;
  createdAt: string;
  categories: CommentCategory[];
  categoryConfidence: number | null;
  replyToCommentId: string | null;
  replyToUserId: string | null;
};

export type FeedFeedback = {
  postId: string;
  authorId: string;
  kind: FeedFeedbackKind;
  createdAt: string;
};

export type FeedEvent = {
  eventType: FeedEventType;
  postId?: string;
  commentId?: string;
  targetUserId?: string;
  source?: string;
  dwellMs?: number;
};

export type SearchHistoryScope = 'users' | 'posts' | 'all';

export type SearchHistoryItem = {
  id: string;
  query: string;
  scope: SearchHistoryScope;
  resultCount: number;
  createdAt: string;
};

export type NotificationType =
  | 'follow'
  | 'comment'
  | 'reaction'
  | 'comment_like'
  | 'follow_post'
  | 'trending'
  | 'account_warning'
  | 'repost'
  | 'bookmark';

/** Unread engagement icons shown on the Drops control. */
export type DropSignal = 'like' | 'repost' | 'comment' | 'bookmark';

export type NotificationCard = {
  id: string;
  type: NotificationType;
  message: string | null;
  actor: PublicUser;
  postId: string | null;
  commentId: string | null;
  readAt: string | null;
  createdAt: string;
};

export type ModerationStatus = 'pending' | 'resolved' | 'dismissed';
export type ReportSubmission = {
  targetType: 'post' | 'comment' | 'user';
  targetId: string;
  reason: 'spam' | 'abuse' | 'illegal' | 'other';
  details?: string;
  alsoBlock?: boolean;
};
export type ReportSubmissionResult = { accepted: true };
export type BugFeedbackSubmission = { description: string; screenshotMediaId?: string | null };
export type BugFeedbackResult = { id: string; status: ModerationStatus };
export type ModerationResolution = { action: Exclude<ModerationStatus, 'pending'>; note?: string };
export type ModerationQueue<T> = { items: T[]; page: number; limit: number };
export type ModerationReport = ReportSubmission & {
  id: string;
  subjectUserId: string | null;
  status: ModerationStatus;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
};
export type ModerationBugFeedback = {
  id: string;
  description: string;
  screenshotMediaId: string | null;
  status: ModerationStatus;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
};
