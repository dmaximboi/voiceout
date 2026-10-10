import { sessions, users, type Db } from '@voiceout/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';
import type { Env } from '../env.js';
import { randomToken, sha256 } from './crypto.js';
import { SESSION_IDLE_COOKIE_SEC, setAuthCookies } from './cookies.js';
import { signAccess } from './jwt.js';
import { httpError } from './http.js';
import { withRlsOff } from './rls.js';

export const SESSION_IDLE_MS = SESSION_IDLE_COOKIE_SEC * 1000;
const MAX_SESSIONS_PER_USER = 8;
const ROTATED_REFRESH_TTL_SEC = SESSION_IDLE_COOKIE_SEC;
/** Parallel tabs/requests refresh with the same cookie; the losers must not look like theft. */
const REFRESH_RACE_GRACE_SEC = 30;

export function refreshGraceKey(refreshHash: string) {
  return `vo:rt-grace:${refreshHash}`;
}

export async function createSession(
  db: Db,
  env: Env,
  userId: string,
  meta: { userAgent?: string; ip?: string },
) {
  // Callers only reach here after credentials / a one-time token proved this account.
  await db.execute(sql`select set_config('app.user_id', ${userId}, true)`);
  const [account] = await db
    .select({ suspendedAt: users.suspendedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (account?.suspendedAt)
    throw httpError(403, 'Account suspended', { code: 'ACCOUNT_SUSPENDED' });
  await pruneSessions(db, userId);
  const refresh = randomToken(32);
  const csrf = randomToken(24);
  const [session] = await db
    .insert(sessions)
    .values({
      userId,
      refreshTokenHash: sha256(refresh),
      userAgent: meta.userAgent?.slice(0, 400) ?? null,
      ip: meta.ip?.slice(0, 64) ?? null,
      expiresAt: new Date(Date.now() + SESSION_IDLE_MS),
    })
    .returning();
  if (!session) throw new Error('session');
  const access = await signAccess(env, { sub: userId, sid: session.id });
  return { access, refresh, csrf, sessionId: session.id };
}

export async function issueSession(
  db: Db,
  env: Env,
  reply: FastifyReply,
  userId: string,
  meta: { userAgent?: string; ip?: string },
) {
  const tokens = await createSession(db, env, userId, meta);
  setAuthCookies(reply, env, tokens.access, tokens.refresh, tokens.csrf);
  return tokens;
}

export async function rotateSession(
  db: Db,
  env: Env,
  redis: Redis,
  reply: FastifyReply,
  session: { id: string; userId: string; refreshTokenHash: string },
  meta: { userAgent?: string; ip?: string },
) {
  await db.execute(sql`select set_config('app.user_id', ${session.userId}, true)`);
  const refresh = randomToken(32);
  const csrf = randomToken(24);
  const [rotated] = await db
    .update(sessions)
    .set({
      refreshTokenHash: sha256(refresh),
      userAgent: meta.userAgent?.slice(0, 400) ?? null,
      ip: meta.ip?.slice(0, 64) ?? null,
      expiresAt: new Date(Date.now() + SESSION_IDLE_MS),
      lastSeenAt: new Date(),
    })
    .where(
      and(eq(sessions.id, session.id), eq(sessions.refreshTokenHash, session.refreshTokenHash)),
    )
    .returning({ id: sessions.id });
  if (!rotated) throw httpError(409, 'Session already refreshed', { code: 'REFRESH_RACE' });
  await redis.set(
    `vo:rt:${session.refreshTokenHash}`,
    session.userId,
    'EX',
    ROTATED_REFRESH_TTL_SEC,
  );
  await redis.set(refreshGraceKey(session.refreshTokenHash), '1', 'EX', REFRESH_RACE_GRACE_SEC);
  const access = await signAccess(env, { sub: session.userId, sid: session.id });
  setAuthCookies(reply, env, access, refresh, csrf);
  return { access, refresh, csrf, sessionId: session.id };
}

/** Old refresh used after rotate → treat as theft and drop every session for that user. */
export async function revokeIfRefreshReused(db: Db, redis: Redis, refreshHash: string) {
  const userId = await redis.getdel(`vo:rt:${refreshHash}`);
  if (!userId) return false;
  await withRlsOff(db, () => db.delete(sessions).where(eq(sessions.userId, userId)));
  return true;
}

export const HANDOFF_TTL_SEC = 5 * 60;

/** One-time login link. Only the hash is stored, so a Redis dump cannot be replayed as logins. */
export async function issueHandoff(
  redis: Redis,
  payload: { userId: string; sessionId?: string },
  ttlSec = HANDOFF_TTL_SEC,
) {
  const key = randomToken(24);
  await redis.set(handoffKey(key), JSON.stringify(payload), 'EX', ttlSec);
  return key;
}

export function handoffKey(key: string) {
  return `vo:handoff:${sha256(key)}`;
}

async function pruneSessions(db: Db, userId: string) {
  const rows = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(asc(sessions.lastSeenAt));
  const extra = rows.length + 1 - MAX_SESSIONS_PER_USER;
  if (extra <= 0) return;
  const drop = rows.slice(0, extra).map((row) => row.id);
  for (const id of drop) {
    await db.delete(sessions).where(eq(sessions.id, id));
  }
}
