import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sessions, users } from '@voiceout/db';
import { eq, sql } from 'drizzle-orm';
import { isOpenRoute } from '../lib/acl.js';
import { assertCsrf, readCookies } from '../lib/cookies.js';
import { timingSafeEqualStr } from '../lib/crypto.js';
import { verifyAccess } from '../lib/jwt.js';
import type { AuthUser } from '../types.js';

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
          req.authUser = null;
        } else {
          await app.db.execute(sql`select set_config('app.user_id', ${session.userId}, true)`);
          const [user] = await app.db.select().from(users).where(eq(users.id, session.userId)).limit(1);
          if (!user || user.deletedAt) {
            req.authUser = null;
          } else {
            req.authUser = {
              id: user.id,
              handle: user.handle,
              email: user.email,
              sid: payload.sid,
              role: user.role,
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
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
  const tokenOk = Boolean(app.env.ADMIN_TOKEN) && timingSafeEqualStr(token, app.env.ADMIN_TOKEN);
  const roleOk = req.authUser?.role === 'admin' || req.authUser?.role === 'moderator';
  if (!tokenOk && !roleOk) {
    const err = new Error('Forbidden');
    (err as Error & { statusCode?: number }).statusCode = 403;
    throw err;
  }
  await app.db.execute(sql`select set_config('app.rls', 'off', true)`);
}
