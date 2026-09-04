import type { FastifyInstance } from 'fastify';
import { notifications, posts, trendingSnapshots, users } from '@voiceout/db';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { requireAuth, requireCsrf } from '../plugins/auth.js';
import { clampLimit } from '../lib/page.js';
import { toPublicUser } from '../lib/users.js';
import { z } from 'zod';

export const notificationReadSchema = z
  .object({
    all: z.literal(true).optional(),
    ids: z.array(z.string().uuid()).min(1).max(100).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.all) !== Boolean(value.ids), {
    message: 'Specify exactly one of all or ids',
  });

export async function notificationRoutes(app: FastifyInstance) {
  app.get('/notifications/unread-count', async (req, reply) => {
    requireAuth(req, reply);
    const [row] = await app.db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, req.authUser!.id), isNull(notifications.readAt)));
    return { count: row?.count ?? 0 };
  });

  app.get('/notifications', async (req, reply) => {
    requireAuth(req, reply);
    const viewer = req.authUser!.id;
    const rows = await app.db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, viewer))
      .orderBy(desc(notifications.createdAt))
      .limit(clampLimit((req.query as { limit?: string }).limit, 50, 50));
    const out = [];
    for (const n of rows) {
      const [actor] = await app.db.select().from(users).where(eq(users.id, n.actorId)).limit(1);
      if (!actor) continue;
      out.push({
        id: n.id,
        type: n.type,
        message: n.message,
        actor: await toPublicUser(app.db, app.env, app.s3, actor),
        postId: n.postId,
        commentId: n.commentId,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      });
    }

    const [snap] = await app.db
      .select()
      .from(trendingSnapshots)
      .orderBy(desc(trendingSnapshots.computedAt))
      .limit(1);
    const trendIds = (snap?.postIds ?? []).slice(0, 6);
    if (trendIds.length) {
      const trendPosts = await app.db
        .select()
        .from(posts)
        .where(and(inArray(posts.id, trendIds), eq(posts.status, 'published')));
      const seen = new Set(out.map((n) => n.postId).filter(Boolean));
      for (const p of trendPosts) {
        if (p.authorId === viewer || seen.has(p.id)) continue;
        const [actor] = await app.db.select().from(users).where(eq(users.id, p.authorId)).limit(1);
        if (!actor) continue;
        out.unshift({
          id: `trend-${p.id}`,
          type: 'trending' as const,
          message: null,
          actor: await toPublicUser(app.db, app.env, app.s3, actor),
          postId: p.id,
          commentId: null,
          readAt: null,
          createdAt: snap?.computedAt.toISOString() ?? p.createdAt.toISOString(),
        });
        seen.add(p.id);
      }
    }

    const [unread] = await app.db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, viewer), isNull(notifications.readAt)));
    return { notifications: out, unreadCount: unread?.count ?? 0 };
  });

  app.post('/notifications/read', async (req, reply) => {
    requireAuth(req, reply);
    requireCsrf(req);
    const body = notificationReadSchema.parse(req.body ?? {});
    if (body.ids?.length) {
      await app.db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.userId, req.authUser!.id),
            inArray(notifications.id, [...new Set(body.ids)]),
            isNull(notifications.readAt),
          ),
        );
    } else {
      await app.db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(and(eq(notifications.userId, req.authUser!.id), isNull(notifications.readAt)));
    }
    return { ok: true };
  });

  app.delete('/notifications', async (req, reply) => {
    requireAuth(req, reply);
    requireCsrf(req);
    await app.db.delete(notifications).where(eq(notifications.userId, req.authUser!.id));
    return { ok: true };
  });
}
