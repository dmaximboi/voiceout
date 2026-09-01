import type { FastifyInstance } from 'fastify';
import { auditLogs, blocks, follows, mediaObjects, mutes, posts, sessions, users } from '@voiceout/db';
import { and, desc, eq, isNull, ne, or, sql } from 'drizzle-orm';
import { handleSchema, updateProfileSchema, changePasswordSchema, deleteAccountSchema } from '@voiceout/shared';
import { requireAuth, requireCsrf } from '../plugins/auth.js';
import { clampLimit } from '../lib/page.js';
import { hydratePosts } from '../lib/hydrate.js';
import { isBlocked, isFollowing, toPublicUser } from '../lib/users.js';
import { assertNameChangeAllowed, assertPasswordChangeAllowed, toMeUser } from '../lib/cooldown.js';
import { notify } from '../lib/notify.js';
import { writeAudit } from '../lib/audit.js';
import { sanitizeText } from '../lib/sanitize.js';
import { hashPassword, verifyPassword } from '../lib/crypto.js';
import { issueSession } from '../lib/session.js';
import { clearAuthCookies } from '../lib/cookies.js';
import { cryptographicallyEraseUser } from '../lib/erasure.js';
import { inferGeo } from '../lib/algo.js';
import { z } from 'zod';

export async function userRoutes(app: FastifyInstance) {
  app.get('/users/suggestions', async (req) => {
    const viewer = req.authUser?.id;
    if (!viewer) return { users: [] };
    const rows = await app.db
      .select()
      .from(users)
      .where(viewer ? and(ne(users.id, viewer), isNull(users.deletedAt)) : isNull(users.deletedAt))
      .orderBy(desc(users.createdAt))
      .limit(clampLimit((req.query as { limit?: string }).limit, 12, 20));
    const filtered = [];
    for (const u of rows) {
      if (viewer && (await isBlocked(app.db, viewer, u.id))) continue;
      if (viewer && (await isFollowing(app.db, viewer, u.id))) continue;
      filtered.push(await toPublicUser(app.db, app.env, app.s3, u));
      if (filtered.length >= 6) break;
    }
    return { users: filtered };
  });

  app.get('/search/users', async (req, reply) => {
    requireAuth(req, reply);
    const q = z.object({ q: z.string().trim().min(1).max(64) }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'Query required' });
    const term = q.data.q.replace(/^@/, '').toLowerCase();
    const rows = await app.db
      .select()
      .from(users)
      .where(
        and(
          isNull(users.deletedAt),
          or(
            sql`${users.handle} % ${term}`,
            sql`${users.displayName} % ${term}`,
            sql`${users.handle} ilike ${'%' + term + '%'}`,
            sql`${users.displayName} ilike ${'%' + term + '%'}`,
          ),
        ),
      )
      .limit(clampLimit((req.query as { limit?: string }).limit, 20, 50));
    const viewer = req.authUser?.id;
    const out = [];
    for (const u of rows) {
      if (viewer && (await isBlocked(app.db, viewer, u.id))) continue;
      out.push(await toPublicUser(app.db, app.env, app.s3, u));
    }
    return { users: out };
  });

  app.patch('/users/me', async (req, reply) => {
    requireAuth(req, reply);
    requireCsrf(req);
    const body = updateProfileSchema.parse(req.body);
    const [current] = await app.db.select().from(users).where(eq(users.id, req.authUser!.id)).limit(1);
    if (!current) return reply.code(404).send({ error: 'Not found' });
    const nextName = body.displayName ? sanitizeText(body.displayName) : current.displayName;
    const nextHandle = body.handle ?? current.handle;
    const renaming = nextName !== current.displayName || nextHandle !== current.handle;
    if (renaming) assertNameChangeAllowed(current);
    if (body.handle && body.handle !== current.handle) {
      const [taken] = await app.db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.handle, body.handle), ne(users.id, req.authUser!.id)))
        .limit(1);
      if (taken) return reply.code(409).send({ error: 'Handle taken' });
    }
    const nextBio = body.bio !== undefined ? sanitizeText(body.bio) : current.bio;
    const geo = body.bio !== undefined ? await inferGeo(app.env, nextBio ?? '', req.id) : null;
    const geoPatch =
      body.bio !== undefined
        ? !(nextBio ?? '').trim()
          ? { lang: null, region: null }
          : {
              ...(geo?.lang ? { lang: geo.lang } : {}),
              ...(geo?.region ? { region: geo.region } : {}),
            }
        : {};
    const [user] = await app.db
      .update(users)
      .set({
        ...(body.displayName ? { displayName: nextName } : {}),
        ...(body.bio !== undefined ? { bio: nextBio } : {}),
        ...(body.handle ? { handle: body.handle } : {}),
        ...geoPatch,
        ...(renaming ? { profileNameChangedAt: new Date() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, req.authUser!.id))
      .returning();
    if (!user) return reply.code(404).send({ error: 'Not found' });
    await writeAudit(app.db, req, renaming ? 'profile_name_change' : 'profile_update');
    return { user: await toMeUser(app.db, app.env, app.s3, user) };
  });

  app.post(
    '/users/me/password',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      requireAuth(req, reply);
      requireCsrf(req);
      const body = changePasswordSchema.parse(req.body);
      const [user] = await app.db.select().from(users).where(eq(users.id, req.authUser!.id)).limit(1);
      if (!user) return reply.code(404).send({ error: 'Not found' });
      assertPasswordChangeAllowed(user);
      if (user.passwordHash) {
        if (!body.currentPassword) return reply.code(400).send({ error: 'Current password required' });
        const ok = await verifyPassword(user.passwordHash, body.currentPassword);
        if (!ok) return reply.code(401).send({ error: 'Current password is wrong' });
        const same = await verifyPassword(user.passwordHash, body.newPassword);
        if (same) return reply.code(400).send({ error: 'Pick a different password' });
      }
      const passwordHash = await hashPassword(body.newPassword);
      await app.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.allow_password', 'on', true)`);
        await tx
          .update(users)
          .set({
            passwordHash,
            failedLoginCount: 0,
            lockedUntil: null,
            passwordChangedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(users.id, user.id));
        await tx.delete(sessions).where(eq(sessions.userId, user.id));
        await tx.insert(auditLogs).values({ userId: user.id, action: 'password_change', ip: req.ip });
      });
      await issueSession(app.db, app.env, reply, user.id, {
        userAgent: req.headers['user-agent'],
        ip: req.ip,
      });
      return { ok: true };
    },
  );

  app.delete(
    '/users/me',
    { config: { rateLimit: { max: 3, timeWindow: '1 hour' } } },
    async (req, reply) => {
      requireAuth(req, reply);
      requireCsrf(req);
      deleteAccountSchema.parse(req.body ?? {});
      await cryptographicallyEraseUser(app.db, app.env, app.s3, req.authUser!.id, req.log);
      await writeAudit(app.db, req, 'account_erase', null);
      clearAuthCookies(reply, app.env);
      return { ok: true };
    },
  );

  app.post('/users/me/avatar', async (req, reply) => {
    requireAuth(req, reply);
    requireCsrf(req);
    const body = z.object({ mediaId: z.string().uuid() }).parse(req.body);
    const [media] = await app.db
      .select()
      .from(mediaObjects)
      .where(and(eq(mediaObjects.id, body.mediaId), eq(mediaObjects.userId, req.authUser!.id)))
      .limit(1);
    if (!media || media.kind !== 'avatar' || media.status !== 'ready') return reply.code(400).send({ error: 'Invalid photo' });
    const [user] = await app.db
      .update(users)
      .set({ avatarMediaId: body.mediaId, updatedAt: new Date() })
      .where(eq(users.id, req.authUser!.id))
      .returning();
    if (!user) return reply.code(404).send({ error: 'Not found' });
    return { user: await toPublicUser(app.db, app.env, app.s3, user) };
  });

  app.get('/users/:handle', async (req, reply) => {
    const { handle } = z.object({ handle: handleSchema }).parse(req.params);
    const [user] = await app.db
      .select({
        id: users.id,
        handle: users.handle,
        displayName: users.displayName,
        bio: users.bio,
        avatarMediaId: users.avatarMediaId,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(and(eq(users.handle, handle), isNull(users.deletedAt)))
      .limit(1);
    if (!user) return reply.code(404).send({ error: 'Not found' });
    if (req.authUser && (await isBlocked(app.db, req.authUser.id, user.id))) {
      return reply.code(404).send({ error: 'Not found' });
    }
    const viewer = req.authUser?.id;
    return {
      user: await toPublicUser(app.db, app.env, app.s3, user),
      following: viewer ? await isFollowing(app.db, viewer, user.id) : false,
      followsYou: viewer ? await isFollowing(app.db, user.id, viewer) : false,
    };
  });

  app.get('/users/:handle/posts', async (req, reply) => {
    const { handle } = z.object({ handle: handleSchema }).parse(req.params);
    const [user] = await app.db
      .select()
      .from(users)
      .where(and(eq(users.handle, handle), isNull(users.deletedAt)))
      .limit(1);
    if (!user) return reply.code(404).send({ error: 'Not found' });
    if (req.authUser && (await isBlocked(app.db, req.authUser.id, user.id))) {
      return reply.code(404).send({ error: 'Not found' });
    }
    const rows = await app.db
      .select()
      .from(posts)
      .where(and(eq(posts.authorId, user.id), eq(posts.status, 'published')))
      .orderBy(desc(posts.createdAt))
      .limit(clampLimit((req.query as { limit?: string }).limit, 40, 50));
    return { posts: await hydratePosts(app.db, app.env, app.s3, rows, req.authUser?.id ?? null) };
  });

  app.post('/users/:id/follow', async (req, reply) => {
    requireAuth(req, reply);
    requireCsrf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    if (id === req.authUser!.id) return reply.code(400).send({ error: 'Cannot follow yourself' });
    if (await isBlocked(app.db, req.authUser!.id, id)) return reply.code(403).send({ error: 'Blocked' });
    const [target] = await app.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);
    if (!target) return reply.code(404).send({ error: 'Not found' });
    await app.db
      .insert(follows)
      .values({ followerId: req.authUser!.id, followeeId: id })
      .onConflictDoNothing();
    await notify(app.db, { userId: id, actorId: req.authUser!.id, type: 'follow' });
    return { ok: true };
  });

  app.delete('/users/:id/follow', async (req, reply) => {
    requireAuth(req, reply);
    requireCsrf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await app.db
      .delete(follows)
      .where(and(eq(follows.followerId, req.authUser!.id), eq(follows.followeeId, id)));
    return { ok: true };
  });

  app.post('/users/:id/block', async (req, reply) => {
    requireAuth(req, reply);
    requireCsrf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    if (id === req.authUser!.id) return reply.code(400).send({ error: 'Cannot block yourself' });
    await app.db.delete(follows).where(
      or(
        and(eq(follows.followerId, req.authUser!.id), eq(follows.followeeId, id)),
        and(eq(follows.followerId, id), eq(follows.followeeId, req.authUser!.id)),
      ),
    );
    await app.db.insert(blocks).values({ blockerId: req.authUser!.id, blockedId: id }).onConflictDoNothing();
    return { ok: true };
  });

  app.delete('/users/:id/block', async (req, reply) => {
    requireAuth(req, reply);
    requireCsrf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await app.db
      .delete(blocks)
      .where(and(eq(blocks.blockerId, req.authUser!.id), eq(blocks.blockedId, id)));
    return { ok: true };
  });

  app.post('/users/:id/mute', async (req, reply) => {
    requireAuth(req, reply);
    requireCsrf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await app.db.insert(mutes).values({ muterId: req.authUser!.id, mutedId: id }).onConflictDoNothing();
    return { ok: true };
  });

  app.delete('/users/:id/mute', async (req, reply) => {
    requireAuth(req, reply);
    requireCsrf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await app.db.delete(mutes).where(and(eq(mutes.muterId, req.authUser!.id), eq(mutes.mutedId, id)));
    return { ok: true };
  });

  app.get('/users/me/blocked', async (req, reply) => {
    requireAuth(req, reply);
    const rows = await app.db.select().from(blocks).where(eq(blocks.blockerId, req.authUser!.id));
    const out = [];
    for (const row of rows) {
      const [u] = await app.db.select().from(users).where(eq(users.id, row.blockedId)).limit(1);
      if (u) out.push(await toPublicUser(app.db, app.env, app.s3, u));
    }
    return { users: out };
  });

  app.get('/users/me/muted', async (req, reply) => {
    requireAuth(req, reply);
    const rows = await app.db.select().from(mutes).where(eq(mutes.muterId, req.authUser!.id));
    const out = [];
    for (const row of rows) {
      const [u] = await app.db.select().from(users).where(eq(users.id, row.mutedId)).limit(1);
      if (u) out.push(await toPublicUser(app.db, app.env, app.s3, u));
    }
    return { users: out };
  });
}
