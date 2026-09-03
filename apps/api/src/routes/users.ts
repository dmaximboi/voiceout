import type { FastifyInstance } from 'fastify';
import { auditLogs, blocks, follows, mediaObjects, mutes, posts, searchQueries, sessions, users } from '@voiceout/db';
import { and, desc, eq, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { handleSchema, updateProfileSchema, changePasswordSchema, deleteAccountSchema, linkEmailSchema, confirmEmailSchema, confirmPhoneSchema } from '@voiceout/shared';
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
import { cryptographicallyEraseUser, findLiveUserByEmail } from '../lib/erasure.js';
import { isUniqueViolation } from '../lib/rls.js';
import { inferGeo } from '../lib/algo.js';
import { sendMail } from '../lib/mail.js';
import { consumeOtpCode, issueOtpCode } from '../lib/tokens.js';
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
    const term = q.data.q.replace(/^@/, '').trim().replace(/\s+/g, ' ').toLowerCase();
    if (!term) return reply.code(400).send({ error: 'Query required' });
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
    await recordSearchQuery(app, req.authUser!.id, term, out.length);
    return { users: out };
  });

  app.get('/search/posts', async (req, reply) => {
    requireAuth(req, reply);
    const q = z.object({ q: z.string().trim().min(1).max(64) }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'Query required' });
    const term = q.data.q.replace(/\s+/g, ' ').trim();
    if (!term) return reply.code(400).send({ error: 'Query required' });
    const rows = await app.db
      .select()
      .from(posts)
      .where(
        and(
          eq(posts.status, 'published'),
          or(sql`${posts.caption} ilike ${'%' + term + '%'}`, sql`${posts.transcript} ilike ${'%' + term + '%'}`),
        ),
      )
      .orderBy(desc(posts.createdAt))
      .limit(clampLimit((req.query as { limit?: string }).limit, 30, 50));
    const cards = await hydratePosts(app.db, app.env, app.s3, rows, req.authUser?.id ?? null);
    await recordSearchQuery(app, req.authUser!.id, term, cards.length, 'posts');
    return { posts: cards };
  });

  app.get('/search/history', async (req, reply) => {
    requireAuth(req, reply);
    const rows = await app.db
      .select()
      .from(searchQueries)
      .where(eq(searchQueries.userId, req.authUser!.id))
      .orderBy(desc(searchQueries.createdAt))
      .limit(clampLimit((req.query as { limit?: string }).limit, 50, 200));
    return {
      history: rows.map((row) => ({
        id: row.id,
        query: row.query,
        scope: row.scope as 'users' | 'posts' | 'all',
        resultCount: row.resultCount,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  });

  app.delete('/search/history', async (req, reply) => {
    requireAuth(req, reply);
    requireCsrf(req);
    await app.db.delete(searchQueries).where(eq(searchQueries.userId, req.authUser!.id));
    return { ok: true };
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
    if (renaming) {
      assertNameChangeAllowed(current);
      const placeholder = current.email.endsWith('@users.invalid');
      if (placeholder) {
        return reply.code(403).send({
          error: 'Add and verify a real email before changing your name',
          code: 'EMAIL_REQUIRED',
        });
      }
      if (!current.emailVerifiedAt) {
        return reply.code(403).send({
          error: 'Verify your email before changing your name',
          code: 'EMAIL_UNVERIFIED',
        });
      }
      if (!body.verificationCode) {
        return reply.code(400).send({
          error: 'Enter the 6-digit code sent to your email',
          code: 'CODE_REQUIRED',
        });
      }
      const otp = await consumeOtpCode(app.redis, 'vo:name', current.id, body.verificationCode);
      if (!otp) return reply.code(400).send({ error: 'Invalid or expired code' });
      if (
        (otp.displayName && otp.displayName !== nextName) ||
        (otp.handle && otp.handle !== nextHandle)
      ) {
        return reply.code(400).send({ error: 'Code does not match this name change. Request a new code.' });
      }
    }
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
    let user: typeof users.$inferSelect;
    try {
      const [updated] = await app.db
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
      if (!updated) return reply.code(404).send({ error: 'Not found' });
      user = updated;
    } catch (err) {
      if (isUniqueViolation(err)) return reply.code(409).send({ error: 'Handle taken' });
      throw err;
    }
    await writeAudit(app.db, req, renaming ? 'profile_name_change' : 'profile_update');
    return { user: await toMeUser(app.db, app.env, app.s3, user) };
  });

  app.post(
    '/users/me/name-code',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      requireAuth(req, reply);
      requireCsrf(req);
      const body = z
        .object({
          displayName: z.string().trim().min(1).max(50).optional(),
          handle: handleSchema.optional(),
        })
        .parse(req.body);
      const [current] = await app.db.select().from(users).where(eq(users.id, req.authUser!.id)).limit(1);
      if (!current) return reply.code(404).send({ error: 'Not found' });
      assertNameChangeAllowed(current);
      if (current.email.endsWith('@users.invalid')) {
        return reply.code(403).send({ error: 'Add a real email first', code: 'EMAIL_REQUIRED' });
      }
      if (!current.emailVerifiedAt) {
        return reply.code(403).send({ error: 'Verify your email first', code: 'EMAIL_UNVERIFIED' });
      }
      const nextName = body.displayName ? sanitizeText(body.displayName) : current.displayName;
      const nextHandle = body.handle ?? current.handle;
      if (nextName === current.displayName && nextHandle === current.handle) {
        return reply.code(400).send({ error: 'Nothing to change' });
      }
      if (nextHandle !== current.handle) {
        const [taken] = await app.db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.handle, nextHandle), ne(users.id, current.id)))
          .limit(1);
        if (taken) return reply.code(409).send({ error: 'Handle taken' });
      }
      const code = await issueOtpCode(app.redis, 'vo:name', current.id, {
        displayName: nextName,
        handle: nextHandle,
      });
      await sendMail(app.env, req.log, {
        to: current.email,
        subject: 'Your VoiceOut name change code',
        text: `Your code is ${code}. It expires in 10 minutes.`,
      });
      return { ok: true };
    },
  );

  app.post(
    '/users/me/email/link',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      requireAuth(req, reply);
      requireCsrf(req);
      const body = linkEmailSchema.parse(req.body);
      const [current] = await app.db.select().from(users).where(eq(users.id, req.authUser!.id)).limit(1);
      if (!current) return reply.code(404).send({ error: 'Not found' });
      if (!current.email.endsWith('@users.invalid') && current.emailVerifiedAt) {
        return reply.code(400).send({ error: 'This account already has a verified email' });
      }
      const existing = await findLiveUserByEmail(app.db, app.env, body.email);
      if (existing && existing.id !== current.id) {
        return reply.code(409).send({
          error: 'An account already uses this email. Log in there instead.',
          code: 'EMAIL_IN_USE',
        });
      }
      const code = await issueOtpCode(app.redis, 'vo:email-link', current.id, { email: body.email });
      await sendMail(app.env, req.log, {
        to: body.email,
        subject: 'Confirm your email for VoiceOut',
        text: `Your code is ${code}. It expires in 10 minutes.`,
      });
      return { ok: true };
    },
  );

  app.post(
    '/users/me/email/confirm',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      requireAuth(req, reply);
      requireCsrf(req);
      const body = confirmEmailSchema.parse(req.body);
      const otp = await consumeOtpCode(app.redis, 'vo:email-link', req.authUser!.id, body.code);
      if (!otp || otp.email !== body.email) {
        return reply.code(400).send({ error: 'Invalid or expired code' });
      }
      const existing = await findLiveUserByEmail(app.db, app.env, body.email);
      if (existing && existing.id !== req.authUser!.id) {
        return reply.code(409).send({
          error: 'An account already uses this email. Log in there instead.',
          code: 'EMAIL_IN_USE',
        });
      }
      const [user] = await app.db
        .update(users)
        .set({
          email: body.email,
          emailVerifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, req.authUser!.id))
        .returning();
      if (!user) return reply.code(404).send({ error: 'Not found' });
      await writeAudit(app.db, req, 'email_linked', req.authUser!.id);
      return { user: await toMeUser(app.db, app.env, app.s3, user) };
    },
  );

  app.post(
    '/users/me/phone',
    { config: { rateLimit: { max: 8, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      requireAuth(req, reply);
      requireCsrf(req);
      const body = confirmPhoneSchema.parse(req.body);
      const phone = body.phone.replace(/[^\d+]/g, '');
      const [taken] = await app.db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.phone, phone), ne(users.id, req.authUser!.id)))
        .limit(1);
      if (taken) {
        return reply.code(409).send({
          error: 'This phone is already on another account. Log in there instead.',
          code: 'PHONE_IN_USE',
        });
      }
      const [user] = await app.db
        .update(users)
        .set({ phone, updatedAt: new Date() })
        .where(eq(users.id, req.authUser!.id))
        .returning();
      if (!user) return reply.code(404).send({ error: 'Not found' });
      await writeAudit(app.db, req, 'phone_set', req.authUser!.id);
      return { user: await toMeUser(app.db, app.env, app.s3, user) };
    },
  );

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
        planTier: users.planTier,
        studioUntil: users.studioUntil,
      })
      .from(users)
      .where(and(eq(users.handle, handle), isNull(users.deletedAt)))
      .limit(1);
    if (!user) return reply.code(404).send({ error: 'Not found' });
    if (req.authUser && (await isBlocked(app.db, req.authUser.id, user.id))) {
      return reply.code(404).send({ error: 'Not found' });
    }
    const viewer = req.authUser?.id;
    let following = false;
    let notifyPosts = false;
    if (viewer) {
      const [rel] = await app.db
        .select({ notifyPosts: follows.notifyPosts })
        .from(follows)
        .where(and(eq(follows.followerId, viewer), eq(follows.followeeId, user.id)))
        .limit(1);
      following = Boolean(rel);
      notifyPosts = Boolean(rel?.notifyPosts);
    }
    return {
      user: await toPublicUser(app.db, app.env, app.s3, user),
      following,
      notifyPosts,
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
    const [existing] = await app.db
      .select({ followerId: follows.followerId, notifyPosts: follows.notifyPosts })
      .from(follows)
      .where(and(eq(follows.followerId, req.authUser!.id), eq(follows.followeeId, id)))
      .limit(1);
    if (existing) return { ok: true, following: true, notifyPosts: existing.notifyPosts };
    await app.db.insert(follows).values({ followerId: req.authUser!.id, followeeId: id, notifyPosts: false });
    await notify(app.db, { userId: id, actorId: req.authUser!.id, type: 'follow' });
    return { ok: true, following: true, notifyPosts: false };
  });

  app.patch('/users/:id/follow', async (req, reply) => {
    requireAuth(req, reply);
    requireCsrf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ notifyPosts: z.boolean() }).parse(req.body);
    const [row] = await app.db
      .update(follows)
      .set({ notifyPosts: body.notifyPosts })
      .where(and(eq(follows.followerId, req.authUser!.id), eq(follows.followeeId, id)))
      .returning({ notifyPosts: follows.notifyPosts });
    if (!row) return reply.code(404).send({ error: 'Not following' });
    return { ok: true, notifyPosts: row.notifyPosts };
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

async function recordSearchQuery(
  app: FastifyInstance,
  userId: string,
  query: string,
  resultCount: number,
  scope: 'users' | 'posts' | 'all' = 'users',
) {
  await app.db.transaction(async (tx) => {
    await tx.insert(searchQueries).values({ userId, query, scope, resultCount });
    await tx
      .delete(searchQueries)
      .where(
        and(
          eq(searchQueries.userId, userId),
          lt(searchQueries.createdAt, new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)),
        ),
      );
    const overflow = await tx
      .select({ id: searchQueries.id })
      .from(searchQueries)
      .where(eq(searchQueries.userId, userId))
      .orderBy(desc(searchQueries.createdAt))
      .offset(200);
    if (overflow.length) {
      await tx.delete(searchQueries).where(inArray(searchQueries.id, overflow.map((row) => row.id)));
    }
  });
}
