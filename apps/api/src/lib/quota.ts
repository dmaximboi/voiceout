import type { Redis } from 'ioredis';

const DAY_UPLOADS = 40;
const DAY_POSTS = 30;

function dayKey(kind: string, userId: string) {
  const day = new Date().toISOString().slice(0, 10);
  return `vo:quota:${kind}:${userId}:${day}`;
}

export async function assertDailyQuota(redis: Redis, kind: 'upload' | 'post', userId: string) {
  const cap = kind === 'upload' ? DAY_UPLOADS : DAY_POSTS;
  const key = dayKey(kind, userId);
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, 60 * 60 * 26);
  if (n > cap) {
    const err = new Error('Daily limit reached');
    (err as Error & { statusCode?: number }).statusCode = 429;
    throw err;
  }
}
