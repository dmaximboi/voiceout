import type { DurationCap, PostReaction, StickerId } from './constants.js';

export type PublicUser = {
  id: string;
  handle: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  followerCount: number;
  followingCount: number;
  createdAt: string;
};

export type MeUser = PublicUser & {
  email: string;
  hasPassword: boolean;
  nameChangeAvailableAt: string;
  passwordChangeAvailableAt: string;
};

export type PostCard = {
  id: string;
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
};

export type NotificationCard = {
  id: string;
  type: 'follow' | 'comment' | 'reaction' | 'comment_like' | 'follow_post' | 'trending';
  actor: PublicUser;
  postId: string | null;
  commentId: string | null;
  readAt: string | null;
  createdAt: string;
};
