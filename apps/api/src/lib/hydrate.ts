import {
  bookmarks,
  comments,
  mediaObjects,
  postReactions,
  posts,
  reposts,
  users,
  voices,
  type Db,
} from '@voiceout/db';
import type { PostCard, PostReaction } from '@voiceout/shared';
import { POST_REACTIONS } from '@voiceout/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { S3Client } from '@aws-sdk/client-s3';
import type { Env } from '../env.js';
import { publicMediaUrl } from './s3.js';
import { toPublicUser } from './users.js';

export async function hydratePosts(
  db: Db,
  env: Env,
  s3: S3Client,
  postRows: (typeof posts.$inferSelect)[],
  viewerId: string | null,
): Promise<PostCard[]> {
  if (postRows.length === 0) return [];
  const ids = postRows.map((p) => p.id);
  const authorIds = [...new Set(postRows.map((p) => p.authorId))];
  const mediaIds = [
    ...new Set([...postRows.map((p) => p.mediaId), ...postRows.flatMap((p) => p.imageIds ?? [])]),
  ];

  const authorRows = await db.select().from(users).where(inArray(users.id, authorIds));
  const authorMap = new Map(authorRows.map((u) => [u.id, u]));

  const mediaRows = await db.select().from(mediaObjects).where(inArray(mediaObjects.id, mediaIds));
  const mediaMap = new Map(mediaRows.map((m) => [m.id, m]));

  const countRows = await db
    .select({
      postId: postReactions.postId,
      type: postReactions.type,
      n: sql<number>`count(*)::int`,
    })
    .from(postReactions)
    .where(inArray(postReactions.postId, ids))
    .groupBy(postReactions.postId, postReactions.type);

  const commentCountRows = await db
    .select({
      postId: comments.postId,
      n: sql<number>`count(*)::int`,
    })
    .from(comments)
    .where(inArray(comments.postId, ids))
    .groupBy(comments.postId);

  const myReactions = viewerId
    ? await db
        .select()
        .from(postReactions)
        .where(and(inArray(postReactions.postId, ids), eq(postReactions.userId, viewerId)))
    : [];

  const myMap = new Map(myReactions.map((r) => [r.postId, r.type]));
  const commentMap = new Map(commentCountRows.map((c) => [c.postId, c.n]));

  const [bookmarkCounts, repostCounts, voiceCounts, myBookmarks, myReposts, myVoices] = await Promise.all([
    db
      .select({ postId: bookmarks.postId, n: sql<number>`count(*)::int` })
      .from(bookmarks)
      .where(inArray(bookmarks.postId, ids))
      .groupBy(bookmarks.postId),
    db
      .select({ postId: reposts.postId, n: sql<number>`count(*)::int` })
      .from(reposts)
      .where(inArray(reposts.postId, ids))
      .groupBy(reposts.postId),
    db
      .select({ postId: voices.postId, n: sql<number>`count(*)::int` })
      .from(voices)
      .where(inArray(voices.postId, ids))
      .groupBy(voices.postId),
    viewerId
      ? db.select({ postId: bookmarks.postId }).from(bookmarks).where(and(inArray(bookmarks.postId, ids), eq(bookmarks.userId, viewerId)))
      : Promise.resolve([] as { postId: string }[]),
    viewerId
      ? db.select({ postId: reposts.postId }).from(reposts).where(and(inArray(reposts.postId, ids), eq(reposts.userId, viewerId)))
      : Promise.resolve([] as { postId: string }[]),
    viewerId
      ? db.select({ postId: voices.postId }).from(voices).where(and(inArray(voices.postId, ids), eq(voices.userId, viewerId)))
      : Promise.resolve([] as { postId: string }[]),
  ]);
  const bookmarkMap = new Map(bookmarkCounts.map((r) => [r.postId, r.n]));
  const repostMap = new Map(repostCounts.map((r) => [r.postId, r.n]));
  const voiceMap = new Map(voiceCounts.map((r) => [r.postId, r.n]));
  const myBookmarkSet = new Set(myBookmarks.map((r) => r.postId));
  const myRepostSet = new Set(myReposts.map((r) => r.postId));
  const myVoiceSet = new Set(myVoices.map((r) => r.postId));

  const reactionMap = new Map<string, Record<PostReaction, number>>();
  for (const id of ids) {
    reactionMap.set(
      id,
      Object.fromEntries(POST_REACTIONS.map((t) => [t, 0])) as Record<PostReaction, number>,
    );
  }
  for (const row of countRows) {
    const rec = reactionMap.get(row.postId);
    if (rec) rec[row.type as PostReaction] = row.n;
  }

  const cards: PostCard[] = [];
  for (const p of postRows) {
    const author = authorMap.get(p.authorId);
    if (!author) continue;
    const media = mediaMap.get(p.mediaId);
    const audioUrl = media && media.status === 'ready' ? publicMediaUrl(media.id) : null;
    const imageUrls = (p.imageIds ?? [])
      .map((id) => {
        const img = mediaMap.get(id);
        return img && img.status === 'ready' ? publicMediaUrl(id) : null;
      })
      .filter((u): u is string => Boolean(u));
    cards.push({
      id: p.id,
      author: await toPublicUser(db, env, s3, author),
      caption: p.caption,
      durationMs: p.durationMs,
      durationCap: p.durationCap as PostCard['durationCap'],
      audioUrl,
      imageUrls,
      videoUrl: null,
      createdAt: p.createdAt.toISOString(),
      reactionCounts: reactionMap.get(p.id)!,
      myReaction: (myMap.get(p.id) as PostReaction | undefined) ?? null,
      commentCount: commentMap.get(p.id) ?? 0,
      bookmarkCount: bookmarkMap.get(p.id) ?? 0,
      repostCount: repostMap.get(p.id) ?? 0,
      voiceCount: voiceMap.get(p.id) ?? 0,
      bookmarkedByMe: myBookmarkSet.has(p.id),
      repostedByMe: myRepostSet.has(p.id),
      voicedByMe: myVoiceSet.has(p.id),
      status: p.status,
    });
  }
  return cards;
}
