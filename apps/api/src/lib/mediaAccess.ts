import { comments, mediaObjects, posts, type Db } from '@voiceout/db';
import { and, eq, sql } from 'drizzle-orm';

type Media = typeof mediaObjects.$inferSelect;

export async function viewerCanReadMedia(db: Db, media: Media, viewerId: string | null) {
  if (media.status !== 'ready') return viewerId === media.userId;
  if (media.kind === 'avatar') return true;
  if (viewerId === media.userId) return true;
  if (media.kind === 'post_audio') {
    const [post] = await db
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.mediaId, media.id), eq(posts.status, 'published')))
      .limit(1);
    return Boolean(post);
  }
  if (media.kind === 'post_image') {
    const [post] = await db
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.status, 'published'), sql`${posts.imageIds} @> ARRAY[${media.id}]::uuid[]`))
      .limit(1);
    return Boolean(post);
  }
  if (media.kind === 'comment_audio') {
    const [row] = await db
      .select({ id: comments.id })
      .from(comments)
      .innerJoin(posts, eq(comments.postId, posts.id))
      .where(and(eq(comments.mediaId, media.id), eq(posts.status, 'published')))
      .limit(1);
    return Boolean(row);
  }
  return false;
}

export function mediaIsPublic(media: Media) {
  return media.status === 'ready' && media.kind === 'avatar';
}
