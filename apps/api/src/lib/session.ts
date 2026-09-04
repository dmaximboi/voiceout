import { sessions, users, type Db } from '@voiceout/db';
import { eq } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import type { Env } from '../env.js';
import { randomToken, sha256 } from './crypto.js';
import { SESSION_IDLE_COOKIE_SEC, setAuthCookies } from './cookies.js';
import { signAccess } from './jwt.js';
import type { Redis } from 'ioredis';
import { httpError } from './http.js';

export const SESSION_IDLE_MS = SESSION_IDLE_COOKIE_SEC * 1000;

export async function createSession(
  db: Db,
  env: Env,
  userId: string,
  meta: { userAgent?: string; ip?: string },
) {
  const [account] = await db
    .select({ suspendedAt: users.suspendedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (account?.suspendedAt) throw httpError(403, 'Account suspended', { code: 'ACCOUNT_SUSPENDED' });
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

export async function issueHandoff(
  redis: Redis,
  tokens: { access: string; refresh: string; csrf: string },
) {
  const key = randomToken(24);
  // Long enough for QR/share; claim is POST so chat-link previews cannot burn it.
  await redis.set(`vo:handoff:${key}`, JSON.stringify(tokens), 'EX', 60 * 60);
  return key;
}
