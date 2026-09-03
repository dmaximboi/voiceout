import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { oauthAccounts, sessions, users } from '@voiceout/db';
import { eq, sql } from 'drizzle-orm';
import { isOpenRoute } from '../lib/acl.js';
import { assertCsrf, readCookies } from '../lib/cookies.js';
import { sha256, timingSafeEqualStr } from '../lib/crypto.js';
import { verifyAccess } from '../lib/jwt.js';
import type { AuthUser } from '../types.js';
import { httpError } from '../lib/http.js';
import { activePlanTier } from '@voiceout/shared';

const LAST_SEEN_MS = 5 * 60 * 1000;

export async function authPlugin(app: FastifyInstance) {
  app.decorateRequest('authUser', null);
  app.addHook('preHandler', async (req) => {
    const path = (req.url.split('?')[0] ?? '').replace(/\/$/, '') || '/';
    if (path === '/auth/csrf' || path === '/health') {
      req.authUser = null;
      return;
    }

    const { access } = readCookies(req);
    if (!access && path === '/auth/me') {
      req.authUser = null;
      const err = new Error('Unauthorized');
      (err as Error & { statusCode?: number }).statusCode = 401;
      throw err;
    }

    await app.db.execute(sql`select set_config('app.rls', 'on', true)`);
    await app.db.execute(sql`select set_config('app.user_id', '', true)`);
    await app.db.execute(sql`select set_config('app.session_id', '', true)`);

    if (!access) {
      req.authUser = null;
    } else {
      const payload = await verifyAccess(app.env, access);
      if (!payload) {
        req.authUser = null;
      } else {
        await app.db.execute(sql`select set_config('app.session_id', ${payload.sid}, true)`);
        const [session] = await app.db.select().from(sessions).where(eq(sessions.id, payload.sid)).limit(1);
        if (!session || session.userId !== payload.sub || session.expiresAt < new Date()) {
          const [suspended] = await app.db
            .select({ suspendedAt: users.suspendedAt })
            .from(users)
            .where(eq(users.id, payload.sub))
            .limit(1);
          if (suspended?.suspendedAt) {
            throw httpError(403, 'Account suspended', { code: 'ACCOUNT_SUSPENDED' });
          }
          req.authUser = null;
        } else {
          await app.db.execute(sql`select set_config('app.user_id', ${session.userId}, true)`);
          const [user] = await app.db.select().from(users).where(eq(users.id, session.userId)).limit(1);
          if (user?.suspendedAt) {
            throw httpError(403, 'Account suspended', { code: 'ACCOUNT_SUSPENDED' });
          } else if (!user || user.deletedAt) {
            req.authUser = null;
          } else {
            const [oauth] = await app.db
              .select({ id: oauthAccounts.id })
              .from(oauthAccounts)
              .where(eq(oauthAccounts.userId, user.id))
              .limit(1);
            req.authUser = {
              id: user.id,
              handle: user.handle,
              email: user.email,
              sid: payload.sid,
              role: user.role,
              isVerifiedIdentity: Boolean(user.emailVerifiedAt || oauth),
              planTier: activePlanTier(user.planTier, user.studioUntil),
              isStudio: Boolean(activePlanTier(user.planTier, user.studioUntil)),
            };
            if (session.lastSeenAt && Date.now() - new Date(session.lastSeenAt).getTime() > LAST_SEEN_MS) {
              await app.db
                .update(sessions)
                .set({ lastSeenAt: new Date() })
                .where(eq(sessions.id, session.id));
            }
          }
        }
      }
    }

    const route = req.routeOptions?.url ?? path;
    if (isOpenRoute(req.method, route)) return;
    if (!req.authUser) {
      const err = new Error('Unauthorized');
      (err as Error & { statusCode?: number }).statusCode = 401;
      throw err;
    }
  });
}

export function requireAuth(req: FastifyRequest, _reply: FastifyReply) {
  if (!req.authUser) {
    const err = new Error('Unauthorized');
    (err as Error & { statusCode?: number }).statusCode = 401;
    throw err;
  }
}

export function requireCsrf(req: FastifyRequest) {
  assertCsrf(req);
}

export function requireVerifiedIdentity(req: FastifyRequest) {
  if (!req.authUser?.isVerifiedIdentity) {
    const err = new Error('Account created. Verify your email in your inbox to continue.');
    (err as Error & { statusCode?: number; code?: string }).statusCode = 403;
    (err as Error & { code?: string }).code = 'EMAIL_UNVERIFIED';
    throw err;
  }
}

export async function requireInternal(app: FastifyInstance, req: FastifyRequest) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
  if (!timingSafeEqualStr(token, app.env.INTERNAL_SERVICE_TOKEN)) {
    const err = new Error('Forbidden');
    (err as Error & { statusCode?: number }).statusCode = 403;
    throw err;
  }
  await app.db.execute(sql`select set_config('app.rls', 'off', true)`);
}

export async function requireAdmin(app: FastifyInstance, req: FastifyRequest) {
  const roleOk = req.authUser?.role === 'admin' || req.authUser?.role === 'moderator';
  if (!roleOk) {
    const err = new Error('Forbidden');
    (err as Error & { statusCode?: number }).statusCode = 403;
    throw err;
  }
  await assertAdminDevice(app, req);
  await app.db.execute(sql`select set_config('app.rls', 'off', true)`);
}

export async function requireAdministrator(app: FastifyInstance, req: FastifyRequest) {
  if (req.authUser?.role !== 'admin') {
    const err = new Error('Forbidden');
    (err as Error & { statusCode?: number }).statusCode = 403;
    throw err;
  }
  await assertAdminDevice(app, req);
  await app.db.execute(sql`select set_config('app.rls', 'off', true)`);
}

const ADMIN_STEPUP_TTL = 30 * 60;

export async function requireAdminStepUp(app: FastifyInstance, req: FastifyRequest) {
  const key = `vo:admin-stepup:${req.authUser!.id}`;
  const ok = await app.redis.get(key);
  if (!ok) {
    throw httpError(403, 'Confirm your identity to continue', { code: 'ADMIN_STEPUP_REQUIRED' });
  }
}

export async function grantAdminStepUp(app: FastifyInstance, userId: string) {
  await app.redis.set(`vo:admin-stepup:${userId}`, '1', 'EX', ADMIN_STEPUP_TTL);
  return ADMIN_STEPUP_TTL;
}

export async function adminStepUpRemaining(app: FastifyInstance, userId: string) {
  const ttl = await app.redis.ttl(`vo:admin-stepup:${userId}`);
  return ttl > 0 ? ttl : 0;
}

async function assertAdminDevice(app: FastifyInstance, req: FastifyRequest) {
  const [row] = await app.db
    .select({ adminDeviceHash: users.adminDeviceHash })
    .from(users)
    .where(eq(users.id, req.authUser!.id))
    .limit(1);
  const expected = row?.adminDeviceHash;
  if (!expected) return;
  const cookie = readCookies(req).device;
  if (!cookie || sha256(cookie) !== expected) {
    throw httpError(403, 'This device is not registered for that account', { code: 'DEVICE_REQUIRED' });
  }
}
