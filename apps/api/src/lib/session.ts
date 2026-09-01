import { sessions, type Db } from '@voiceout/db';
import type { FastifyReply } from 'fastify';
import type { Env } from '../env.js';
import { randomToken, sha256 } from './crypto.js';
import { setAuthCookies } from './cookies.js';
import { signAccess } from './jwt.js';
import type { Redis } from 'ioredis';

export async function createSession(
  db: Db,
  env: Env,
  userId: string,
  meta: { userAgent?: string; ip?: string },
) {
  const refresh = randomToken(32);
  const csrf = randomToken(24);
  const [session] = await db
    .insert(sessions)
    .values({
      userId,
      refreshTokenHash: sha256(refresh),
      userAgent: meta.userAgent?.slice(0, 400) ?? null,
      ip: meta.ip?.slice(0, 64) ?? null,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })
    .returning();
  if (!session) throw new Error('session');
  const access = await signAccess(env, { sub: userId, sid: session.id });
  return { access, refresh, csrf };
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
  await redis.set(`vo:handoff:${key}`, JSON.stringify(tokens), 'EX', 90);
  return key;
}
