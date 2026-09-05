import type { FastifyInstance } from 'fastify';
import {
  commentLikes,
  comments,
  mediaObjects,
  postReactions,
  posts,
  shareClicks,
} from '@voiceout/db';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  COMMENT_CATEGORIES,
  DURATION_PROBE_SLACK_MS,
  canDeleteOwnPost,
  canEditPostCaption,
  canUseDurationCap,
  canVoiceComment,
  createCommentSchema,
  createPostSchema,
  maxCaptionLength,
  maxCommentLength,
  maxPostImages,
  maxVoiceCommentSeconds,
  reactSchema,
  reportSchema,
  updatePostCaptionSchema,
  type CommentCard,
} from '@voiceout/shared';
import { requireAuth, requireCsrf, requireInternal, requireVerifiedIdentity } from '../plugins/auth.js';
import { writeAudit } from '../lib/audit.js';
import { classifyComment, inferGeo } from '../lib/algo.js';
import { hydratePosts } from '../lib/hydrate.js';
import { withIdempotency } from '../lib/idempotency.js';
import { notify, notifyFollowersOfPost } from '../lib/notify.js';
import { enqueue } from '../lib/queue.js';
import { deleteObject } from '../lib/s3.js';
import { generateShareCode, looksLikeShareCode, looksLikeUuid, postIdParamSchema, resolvePostRef } from '../lib/shareCode.js';
import { assertDailyQuota } from '../lib/quota.js';
import { sanitizeText } from '../lib/sanitize.js';
import { publicMediaUrl } from '../lib/s3.js';
import { submitReport } from '../lib/safety.js';
import { toPublicUser, deletedPublicUser } from '../lib/users.js';
import { users } from '@voiceout/db';
import { z } from 'zod';

export async function postRoutes(app: FastifyInstance) {
  app.post('/posts', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    requireAuth(req, reply);
    requireVerifiedIdentity(req);
    requireCsrf(req);
    return withIdempotency(app.redis, req, reply, async () => {
    const body = createPostSchema.parse(req.body);
    const [media] = await app.db
      .select()
      .from(mediaObjects)
      .where(and(eq(mediaObjects.id, body.mediaId), eq(mediaObjects.userId, req.authUser!.id)))
      .limit(1);
    if (!media || media.kind !== 'post_audio') return reply.code(400).send({ error: 'Invalid media' });
    if (!canUseDurationCap(body.durationCap, req.authUser!.planTier)) {
      return reply.code(403).send({ error: 'Upgrade your plan for that recording length', code: 'PLAN_REQUIRED' });
    }
    const imageIds = [...new Set(body.imageIds ?? [])].slice(0, maxPostImages(req.authUser!.planTier));
    if (imageIds.length) {
      const images = await app.db
        .select()
        .from(mediaObjects)
        .where(and(eq(mediaObjects.userId, req.authUser!.id), inArray(mediaObjects.id, imageIds)));
      if (
        images.length !== imageIds.length ||
        images.some((row) => row.kind !== 'post_image' || row.status !== 'ready')
      ) {
        return reply.code(400).send({ error: 'Invalid images' });
      }
    }
    await assertDailyQuota(app.redis, 'post', req.authUser!.id);
    const captionLimit = maxCaptionLength(req.authUser!.planTier);
    if (body.caption.length > captionLimit) {
      return reply.code(400).send({ error: `Caption max ${captionLimit} characters on your plan` });
    }
    const caption = sanitizeText(body.caption);
    const geo = await inferGeo(app.env, [caption, body.transcript ?? ''].join(' '), req.id);
    const status = app.env.SKIP_MEDIA_PROBE || media.status === 'ready' ? 'published' : 'pending';
    const durationMs = Math.min(
      body.durationMs ?? media.durationMs ?? body.durationCap * 1000,
      body.durationCap * 1000 + 2000,
    );
    await app.db.update(mediaObjects).set({ durationMs }).where(eq(mediaObjects.id, media.id));
    let post: typeof posts.$inferSelect | undefined;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const [row] = await app.db
          .insert(posts)
          .values({
            authorId: req.authUser!.id,
            caption,
            transcript: body.transcript ? sanitizeText(body.transcript).slice(0, 4000) : null,
            mediaId: media.id,
            imageIds,
            durationMs,
            durationCap: body.durationCap,
            status,
            lang: geo.lang || null,
            region: geo.region || null,
            shareCode: generateShareCode(10),
          })
          .returning();
        post = row;
        break;
      } catch (err) {
        if (attempt === 5) throw err;
      }
    }
    if (!post) return reply.code(500).send({ error: 'Failed' });
    if (status === 'published') {
      await notifyFollowersOfPost(app.db, req.authUser!.id, post.id);
    }
    if (!app.env.SKIP_MEDIA_PROBE && media.status !== 'ready') {
      await enqueue(app.queues.mediaProbe, 'probe', { mediaId: media.id, postId: post.id });
    }
    if (!app.env.KILL_TRANSCRIBE) {
      await enqueue(app.queues.transcribe, 'transcribe', {
        postId: post.id,
        mediaId: media.id,
        caption: post.caption,
        draftTranscript: post.transcript ?? '',
      });
    }
    const [card] = await hydratePosts(app.db, app.env, app.s3, [post], req.authUser!.id);
    return { post: card };
    });
  });

  app.get('/posts/:id', async (req, reply) => {
    const { id } = z.object({ id: postIdParamSchema() }).parse(req.params);
    const [post] = looksLikeUuid(id)
      ? await app.db.select().from(posts).where(eq(posts.id, id)).limit(1)
      : looksLikeShareCode(id)
        ? await app.db.select().from(posts).where(eq(posts.shareCode, id)).limit(1)
        : [];
    if (!post || (post.status !== 'published' && post.authorId !== req.authUser?.id)) {
      return reply.code(404).send({ error: 'Not found' });
    }
    const [card] = await hydratePosts(app.db, app.env, app.s3, [post], req.authUser?.id ?? null);
    return { post: card };
  });

  app.post('/posts/:id/share-open', async (req, reply) => {
    requireAuth(req, reply);
    requireCsrf(req);
    const { id: ref } = z.object({ id: postIdParamSchema() }).parse(req.params);
    const id = await resolvePostRef(app.db, ref);
    if (!id) return reply.code(404).send({ error: 'Not found' });
    const body = z.object({ via: z.string().uuid() }).parse(req.body);
    if (body.via === req.authUser!.id) return { ok: true };
    const [post] = await app.db.select({ id: posts.id }).from(posts).where(eq(posts.id, id)).limit(1);
    if (!post) return reply.code(404).send({ error: 'Not found' });
    await app.db
      .insert(shareClicks)
      .values({ postId: id, sharerId: body.via, clickerId: req.authUser!.id })
      .onConflictDoNothing();
    return { ok: true };
  });

  app.patch('/posts/:id', async (req, reply) => {
    requireAuth(req, reply);
    requireCsrf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = updatePostCaptionSchema.parse(req.body);
    if (!canEditPostCaption(req.authUser!.planTier)) {
      return reply.code(403).send({
        error: 'Subscribe from $1 to edit captions',
        code: 'PLAN_REQUIRED',
      });
    }
    const captionLimit = maxCaptionLength(req.authUser!.planTier);
    if (body.caption.length > captionLimit) {
      return reply.code(400).send({ error: `Caption max ${captionLimit} characters on your plan` });
    }
    const caption = sanitizeText(body.caption);
    const updated = await app.db
      .update(posts)
      .set({ caption })
      .where(and(eq(posts.id, id), eq(posts.authorId, req.authUser!.id)))
      .returning();
    if (updated.length === 0) return reply.code(404).send({ error: 'Not found' });
    await writeAudit(app.db, req, 'post_caption_edit', req.authUser!.id, { postId: id });
    const [card] = await hydratePosts(app.db, app.env, app.s3, updated, req.authUser!.id);
    return { post: card };
  });

  app.delete('/posts/:id', async (req, reply) => {
    requireAuth(req, reply);
    requireCsrf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [existing] = await app.db
      .select({ id: posts.id, createdAt: posts.createdAt })
      .from(posts)
      .where(and(eq(posts.id, id), eq(posts.authorId, req.authUser!.id)))
      .limit(1);
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    if (!canDeleteOwnPost(existing.createdAt, req.authUser!.planTier)) {
      return reply.code(403).send({
        error: 'Free accounts can delete only within 24 hours. Subscribe from $1 to delete anytime.',
        code: 'PLAN_REQUIRED',
      });
    }
    const deleted = await app.db
      .delete(posts)
      .where(and(eq(posts.id, id), eq(posts.authorId, req.authUser!.id)))
      .returning();
    if (deleted.length === 0) return reply.code(404).send({ error: 'Not found' });
    const gone = deleted[0]!;
    const mediaIds = [gone.mediaId, ...(gone.imageIds ?? [])].filter(Boolean);
    if (mediaIds.length) {
      const mediaRows = await app.db.select().from(mediaObjects).where(inArray(mediaObjects.id, mediaIds));
      await app.db.delete(mediaObjects).where(inArray(mediaObjects.id, mediaIds));
      for (const row of mediaRows) {
        try {
          await deleteObject(app.env, app.s3, row.objectKey);
        } catch (err) {
          req.log.warn({ err, key: row.objectKey }, 'post delete media purge failed');
        }
      }
    }
    await writeAudit(app.db, req, 'post_delete');
    return { ok: true };
  });

  app.put('/posts/:id/reactions', async (req, reply) => {
    requireAuth(req, reply);
    requireCsrf(req);
    const { id: ref } = z.object({ id: postIdParamSchema() }).parse(req.params);
    const id = await resolvePostRef(app.db, ref);
    if (!id) return reply.code(404).send({ error: 'Not found' });
    const { type } = reactSchema.parse(req.body);
    const [post] = await app.db.select().from(posts).where(eq(posts.id, id)).limit(1);
    if (!post || post.status !== 'published') return reply.code(404).send({ error: 'Not found' });
    await app.db
      .insert(postReactions)
      .values({ postId: id, userId: req.authUser!.id, type })
      .onConflictDoUpdate({
        target: [postReactions.postId, postReactions.userId],
        set: { type },
      });
    await notify(app.db, {
      userId: post.authorId,
      actorId: req.authUser!.id,
      type: 'reaction',
      postId: id,
    });
    return { ok: true, type };
  });

  app.delete('/posts/:id/reactions', async (req, reply) => {
    requireAuth(req, reply);
    requireCsrf(req);
    const { id: ref } = z.object({ id: postIdParamSchema() }).parse(req.params);
    const id = await resolvePostRef(app.db, ref);
    if (!id) return reply.code(404).send({ error: 'Not found' });
    await app.db
      .delete(postReactions)
      .where(and(eq(postReactions.postId, id), eq(postReactions.userId, req.authUser!.id)));
    return { ok: true };
  });

  app.get('/posts/:id/comments', async (req, reply) => {
    const { id: ref } = z.object({ id: postIdParamSchema() }).parse(req.params);
    const id = await resolvePostRef(app.db, ref);
    if (!id) return reply.code(404).send({ error: 'Not found' });
    const [shared] = await app.db.select().from(posts).where(eq(posts.id, id)).limit(1);
    if (!shared || (shared.status !== 'published' && shared.authorId !== req.authUser?.id)) {
      return reply.code(404).send({ error: 'Not found' });
    }
    const rows = await app.db
      .select()
      .from(comments)
      .where(eq(comments.postId, id))
      .orderBy(desc(comments.createdAt))
      .limit(100);
    const viewer = req.authUser?.id;
    const out = [];
    for (const c of rows) {
      const [author] = await app.db.select().from(users).where(eq(users.id, c.authorId)).limit(1);
      const publicAuthor = author
        ? await toPublicUser(app.db, app.env, app.s3, author)
        : deletedPublicUser(c.authorId);
      const [likeRow] = await app.db
        .select({ n: sql<number>`count(*)::int` })
        .from(commentLikes)
        .where(eq(commentLikes.commentId, c.id));
      let likedByMe = false;
      if (viewer) {
        const mine = await app.db
          .select()
          .from(commentLikes)
          .where(and(eq(commentLikes.commentId, c.id), eq(commentLikes.userId, viewer)))
          .limit(1);
        likedByMe = mine.length > 0;
      }
      let audioUrl: string | null = null;
      let durationMs: number | null = null;
      if (c.mediaId) {
        const [media] = await app.db.select().from(mediaObjects).where(eq(mediaObjects.id, c.mediaId)).limit(1);
        if (media && media.status === 'ready') {
          audioUrl = publicMediaUrl(media.id);
          durationMs = media.durationMs;
        }
      }
      out.push({
        id: c.id,
        author: publicAuthor,
        body: c.body,
        stickerId: c.stickerId,
        durationMs,
        audioUrl,
        likeCount: likeRow?.n ?? 0,
        likedByMe,
        createdAt: c.createdAt.toISOString(),
        categories: [c.category, c.secondaryCategory].filter(
          (category): category is CommentCard['categories'][number] =>
            Boolean(category) &&
            COMMENT_CATEGORIES.includes(category as CommentCard['categories'][number]),
        ),
        categoryConfidence: c.categoryConfidence,
        replyToCommentId: c.replyToCommentId,
        replyToUserId: c.replyToUserId,
      });
    }
    return { comments: out };
  });

  app.post('/posts/:id/comments', { config: { rateLimit: { max: 40, timeWindow: '1 minute' } } }, async (req, reply) => {
    requireAuth(req, reply);
    requireVerifiedIdentity(req);
    requireCsrf(req);
    const { id: ref } = z.object({ id: postIdParamSchema() }).parse(req.params);
    const id = await resolvePostRef(app.db, ref);
    if (!id) return reply.code(404).send({ error: 'Not found' });
    const body = createCommentSchema.parse(req.body);
    const [post] = await app.db.select().from(posts).where(eq(posts.id, id)).limit(1);
    if (!post || post.status !== 'published') return reply.code(404).send({ error: 'Not found' });
    let replyToUserId: string | null = null;
    if (body.replyToCommentId) {
      const [parent] = await app.db
        .select({ postId: comments.postId, authorId: comments.authorId })
        .from(comments)
        .where(eq(comments.id, body.replyToCommentId))
        .limit(1);
      if (!parent || parent.postId !== id) {
        return reply.code(400).send({ error: 'Reply target must belong to this post' });
      }
      replyToUserId = parent.authorId;
    }
    if (body.mediaId) {
      if (!canVoiceComment(req.authUser!.planTier)) {
        return reply.code(403).send({
          error: 'Subscribe from $1 to send voice replies',
          code: 'PLAN_REQUIRED',
        });
      }
      const [media] = await app.db
        .select()
        .from(mediaObjects)
        .where(and(eq(mediaObjects.id, body.mediaId), eq(mediaObjects.userId, req.authUser!.id)))
        .limit(1);
      if (!media || media.kind !== 'comment_audio') return reply.code(400).send({ error: 'Invalid media' });
      const maxMs = maxVoiceCommentSeconds(req.authUser!.planTier) * 1000;
      const durationMs = media.durationMs ?? (media.durationCap ? media.durationCap * 1000 : null);
      if (durationMs != null && durationMs > maxMs + DURATION_PROBE_SLACK_MS) {
        return reply.code(400).send({ error: `Voice reply max ${maxVoiceCommentSeconds(req.authUser!.planTier)}s on your plan` });
      }
    }
    const cleanBody = sanitizeText(body.body ?? '');
    const commentLimit = maxCommentLength(req.authUser!.planTier);
    if (cleanBody.length > commentLimit) {
      return reply.code(400).send({ error: `Comment max ${commentLimit} characters on your plan` });
    }
    const classification = await classifyComment(app.env, cleanBody, body.stickerId, req.id);
    const [comment] = await app.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(comments)
        .values({
          postId: id,
          authorId: req.authUser!.id,
          body: cleanBody,
          mediaId: body.mediaId ?? null,
          stickerId: body.stickerId ?? null,
          category: classification.primary,
          secondaryCategory: classification.secondary,
          categoryConfidence: classification.confidence,
          replyToCommentId: body.replyToCommentId ?? null,
          replyToUserId,
        })
        .returning();
      if (created && classification.primary !== 'neutral') {
        await tx
          .update(posts)
          .set({
            commentCategories: sql`jsonb_set(
              ${posts.commentCategories},
              ARRAY[${classification.primary}]::text[],
              to_jsonb(COALESCE((${posts.commentCategories}->>${classification.primary})::int, 0) + 1),
              true
            )`,
          })
          .where(eq(posts.id, id));
      }
      return [created];
    });
    if (!comment) return reply.code(500).send({ error: 'Failed' });
    if (body.mediaId && !app.env.SKIP_MEDIA_PROBE) {
      await enqueue(app.queues.mediaProbe, 'probe', { mediaId: body.mediaId, commentId: comment.id });
    }
    await notify(app.db, {
      userId: replyToUserId ?? post.authorId,
      actorId: req.authUser!.id,
      type: 'comment',
      postId: id,
      commentId: comment.id,
    });
    const [author] = await app.db.select().from(users).where(eq(users.id, req.authUser!.id)).limit(1);
    return {
      commentId: comment.id,
      comment: {
        id: comment.id,
        author: author ? await toPublicUser(app.db, app.env, app.s3, author) : deletedPublicUser(comment.authorId),
        body: comment.body,
        stickerId: comment.stickerId as CommentCard['stickerId'],
        durationMs: null,
        audioUrl: comment.mediaId ? publicMediaUrl(comment.mediaId) : null,
        likeCount: 0,
        likedByMe: false,
        createdAt: comment.createdAt.toISOString(),
        categories: [comment.category, comment.secondaryCategory].filter(
          (category): category is CommentCard['categories'][number] =>
            Boolean(category) &&
            COMMENT_CATEGORIES.includes(category as CommentCard['categories'][number]),
        ),
        categoryConfidence: comment.categoryConfidence,
        replyToCommentId: comment.replyToCommentId,
        replyToUserId: comment.replyToUserId,
      } satisfies CommentCard,
    };
  });

  app.post('/comments/:id/like', async (req, reply) => {
    requireAuth(req, reply);
    requireCsrf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [comment] = await app.db.select().from(comments).where(eq(comments.id, id)).limit(1);
    if (!comment) return reply.code(404).send({ error: 'Not found' });
    await app.db.insert(commentLikes).values({ commentId: id, userId: req.authUser!.id }).onConflictDoNothing();
    await notify(app.db, {
      userId: comment.authorId,
      actorId: req.authUser!.id,
      type: 'comment_like',
      postId: comment.postId,
      commentId: id,
    });
    return { ok: true };
  });

  app.delete('/comments/:id/like', async (req, reply) => {
    requireAuth(req, reply);
    requireCsrf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await app.db
      .delete(commentLikes)
      .where(and(eq(commentLikes.commentId, id), eq(commentLikes.userId, req.authUser!.id)));
    return { ok: true };
  });

  app.post('/reports', async (req, reply) => {
    requireAuth(req, reply);
    requireCsrf(req);
    const body = reportSchema.parse(req.body);
    await submitReport(app.db, req.authUser!.id, body);
    return reply.code(202).send({ accepted: true });
  });

  app.post('/internal/posts/:id/status', async (req, reply) => {
    await requireInternal(app, req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ status: z.enum(['published', 'rejected']), durationMs: z.number().optional() }).parse(req.body);
    const [existing] = await app.db.select().from(posts).where(eq(posts.id, id)).limit(1);
    await app.db
      .update(posts)
      .set({
        status: body.status,
        ...(body.durationMs ? { durationMs: body.durationMs } : {}),
      })
      .where(eq(posts.id, id));
    if (existing && existing.status !== 'published' && body.status === 'published') {
      await notifyFollowersOfPost(app.db, existing.authorId, existing.id);
    }
    return { ok: true };
  });

  app.post('/internal/posts/:id/transcript', async (req, reply) => {
    await requireInternal(app, req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ transcript: z.string().max(8000) }).parse(req.body);
    await app.db.update(posts).set({ transcript: body.transcript }).where(eq(posts.id, id));
    return { ok: true };
  });
}
