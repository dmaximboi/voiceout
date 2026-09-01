import { notifications, type Db } from '@voiceout/db';
import { sql } from 'drizzle-orm';

export async function notify(
  db: Db,
  input: {
    userId: string;
    actorId: string;
    type: 'follow' | 'comment' | 'reaction' | 'comment_like' | 'follow_post' | 'trending';
    postId?: string | null;
    commentId?: string | null;
  },
) {
  if (input.userId === input.actorId) return;
  await db.insert(notifications).values({
    userId: input.userId,
    actorId: input.actorId,
    type: input.type,
    postId: input.postId ?? null,
    commentId: input.commentId ?? null,
  });
}

export async function notifyFollowersOfPost(db: Db, authorId: string, postId: string) {
  await db.execute(sql`
    insert into notifications (user_id, actor_id, type, post_id)
    select follower_id, ${authorId}::uuid, 'follow_post'::notification_type, ${postId}::uuid
    from follows
    where followee_id = ${authorId}::uuid
  `);
}
