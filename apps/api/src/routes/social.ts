import type { FastifyInstance } from 'fastify';
import { bookmarks, posts, reposts, voices } from '@voiceout/db';
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { voiceSchema } from '@voiceout/shared';
import { requireAuth, requireCsrf } from '../plugins/auth.js';
import { hydratePosts } from '../lib/hydrate.js';
import { notify } from '../lib/notify.js';
import { sanitizeText } from '../lib/sanitize.js';
import { toPublicUser } from '../lib/users.js';
import { users } from '@voiceout/db';
import { z } from 'zod';

export async function socialRoutes(app: FastifyInstance) {
  app.post('/posts/:id/bookmark', async (req, reply) => {
    requireAuth(req, reply);
    requireCsrf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [post] = await app.db.select({ id: posts.id }).from(posts).where(eq(posts.id, id)).limit(1);
    if (!post) return reply.code(404).send({ error: 'Not found' });
    await app.db.insert(bookmarks).values({ userId: req.authUser!.id, postId: id }).onConflictDoNothing();
    return { ok: true };
  });

  app.delete('/posts/:id/bookmark', async (req, reply) => {
    requireAuth(req, reply);
    requireCsrf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await app.db.delete(bookmarks).where(and(eq(bookmarks.userId, req.authUser!.id), eq(bookmarks.postId, id)));
    return { ok: true };
  });

  app.post('/posts/:id/repost', async (req, reply) => {
    requireAuth(req, reply);
    requireCsrf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [post] = await app.db.select().from(posts).where(eq(posts.id, id)).limit(1);
    if (!post) return reply.code(404).send({ error: 'Not found' });
    await app.db.insert(reposts).values({ userId: req.authUser!.id, postId: id }).onConflictDoNothing();
    if (post.authorId !== req.authUser!.id) {
      await notify(app.db, { userId: post.authorId, actorId: req.authUser!.id, type: 'reaction', postId: id });
    }
    return { ok: true };
  });

  app.delete('/posts/:id/repost', async (req, reply) => {
    requireAuth(req, reply);
    requireCsrf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await app.db.delete(reposts).where(and(eq(reposts.userId, req.authUser!.id), eq(reposts.postId, id)));
    return { ok: true };
  });

  app.post('/posts/:id/voice', async (req, reply) => {
    requireAuth(req, reply);
    requireCsrf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = voiceSchema.parse(req.body);
    const [post] = await app.db.select().from(posts).where(eq(posts.id, id)).limit(1);
    if (!post) return reply.code(404).send({ error: 'Not found' });
    const [row] = await app.db
      .insert(voices)
      .values({ userId: req.authUser!.id, postId: id, body: sanitizeText(body.body) })
      .onConflictDoUpdate({
        target: [voices.userId, voices.postId],
        set: { body: sanitizeText(body.body) },
      })
      .returning();
    if (post.authorId !== req.authUser!.id) {
      await notify(app.db, { userId: post.authorId, actorId: req.authUser!.id, type: 'comment', postId: id });
    }
    return { voice: row };
  });

  app.delete('/posts/:id/voice', async (req, reply) => {
    requireAuth(req, reply);
    requireCsrf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await app.db.delete(voices).where(and(eq(voices.userId, req.authUser!.id), eq(voices.postId, id)));
    return { ok: true };
  });

  app.get('/users/me/bookmarks', async (req, reply) => {
    requireAuth(req, reply);
    const q = z.object({ lastKey: z.string().max(80).optional() }).safeParse(req.query);
    const lastKey = q.success ? q.data.lastKey : undefined;
    let cursorAt: Date | null = null;
    let cursorId = '';
    if (lastKey) {
      const [rawAt, rawId] = lastKey.split('|');
      const at = rawAt ? new Date(rawAt) : null;
      if (at && !Number.isNaN(at.getTime()) && rawId && /^[0-9a-f-]{36}$/i.test(rawId)) {
        cursorAt = at;
        cursorId = rawId;
      }
    }
    const rows = await app.db
      .select({ post: posts, createdAt: bookmarks.createdAt, postId: bookmarks.postId })
      .from(bookmarks)
      .innerJoin(posts, eq(posts.id, bookmarks.postId))
      .where(
        and(
          eq(bookmarks.userId, req.authUser!.id),
          cursorAt
            ? or(
                lt(bookmarks.createdAt, cursorAt),
                and(eq(bookmarks.createdAt, cursorAt), lt(bookmarks.postId, cursorId)),
              )
            : sql`true`,
        ),
      )
      .orderBy(desc(bookmarks.createdAt), desc(bookmarks.postId))
      .limit(41);
    const page = rows.slice(0, 40);
    const last = page[page.length - 1];
    return {
      posts: await hydratePosts(
        app.db,
        app.env,
        app.s3,
        page.map((r) => r.post),
        req.authUser!.id,
      ),
      lastKey: rows.length > 40 && last ? `${last.createdAt.toISOString()}|${last.postId}` : null,
    };
  });

  app.get('/users/me/voiced', async (req, reply) => {
    requireAuth(req, reply);
    const voiceRows = await app.db
      .select()
      .from(voices)
      .where(eq(voices.userId, req.authUser!.id))
      .orderBy(desc(voices.createdAt))
      .limit(40);
    const repostRows = await app.db
      .select()
      .from(reposts)
      .where(eq(reposts.userId, req.authUser!.id))
      .orderBy(desc(reposts.createdAt))
      .limit(40);
    const postIds = [...new Set([...voiceRows.map((v) => v.postId), ...repostRows.map((r) => r.postId)])];
    if (postIds.length === 0) return { items: [] };
    const postRows = await app.db.select().from(posts).where(and(eq(posts.status, 'published'), inArray(posts.id, postIds)));
    const cards = await hydratePosts(app.db, app.env, app.s3, postRows, req.authUser!.id);
    const byId = new Map(cards.map((c) => [c.id, c]));
    const [me] = await app.db.select().from(users).where(eq(users.id, req.authUser!.id)).limit(1);
    const actor = me ? await toPublicUser(app.db, app.env, app.s3, me) : null;
    const items = [
      ...voiceRows.map((v) => ({
        id: v.id,
        type: 'voice' as const,
        createdAt: v.createdAt.toISOString(),
        actor,
        body: v.body,
        post: byId.get(v.postId)!,
      })),
      ...repostRows.map((r) => ({
        id: `repost-${r.userId}-${r.postId}`,
        type: 'repost' as const,
        createdAt: r.createdAt.toISOString(),
        actor,
        body: null,
        post: byId.get(r.postId)!,
      })),
    ]
      .filter((i) => i.post)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return { items };
  });
}
