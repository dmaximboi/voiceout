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
