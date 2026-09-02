import type { Redis } from 'ioredis';
import { randomToken, sha256 } from './crypto.js';

export async function issueRedisToken(redis: Redis, prefix: string, userId: string, ttlSec: number) {
  const token = randomToken(32);
  await redis.set(`${prefix}:${sha256(token)}`, userId, 'EX', ttlSec);
  return token;
}

export async function consumeRedisToken(redis: Redis, prefix: string, token: string) {
  const key = `${prefix}:${sha256(token)}`;
  const userId = await redis.get(key);
  if (!userId) return null;
  await redis.del(key);
  return userId;
}

export async function issueOtpCode(
  redis: Redis,
  prefix: string,
  userId: string,
  payload: Record<string, string>,
  ttlSec = 600,
) {
  const code = String(100000 + Math.floor(Math.random() * 900000));
  await redis.set(
    `${prefix}:${userId}`,
    JSON.stringify({ codeHash: sha256(code), ...payload }),
    'EX',
    ttlSec,
  );
  return code;
}

export async function consumeOtpCode(redis: Redis, prefix: string, userId: string, code: string) {
  const key = `${prefix}:${userId}`;
  const raw = await redis.get(key);
  if (!raw) return null;
  const data = JSON.parse(raw) as { codeHash: string } & Record<string, string>;
  if (data.codeHash !== sha256(code.trim())) return null;
  await redis.del(key);
  return data;
}
