import { randomInt } from 'node:crypto';
import type { Redis } from 'ioredis';
import { randomToken, sha256, timingSafeEqualStr } from './crypto.js';

const OTP_MAX_ATTEMPTS = 5;

export async function issueRedisToken(
  redis: Redis,
  prefix: string,
  userId: string,
  ttlSec: number,
) {
  const token = randomToken(32);
  await redis.set(`${prefix}:${sha256(token)}`, userId, 'EX', ttlSec);
  return token;
}

/** Atomic read-and-delete so two parallel requests cannot both redeem one token. */
export async function consumeRedisToken(redis: Redis, prefix: string, token: string) {
  return redis.getdel(`${prefix}:${sha256(token)}`);
}

export async function issueOtpCode(
  redis: Redis,
  prefix: string,
  userId: string,
  payload: Record<string, string>,
  ttlSec = 600,
) {
  const code = String(randomInt(100000, 1000000));
  await redis.set(
    `${prefix}:${userId}`,
    JSON.stringify({ codeHash: sha256(code), ...payload }),
    'EX',
    ttlSec,
  );
  await redis.del(`${prefix}:tries:${userId}`);
  return code;
}

/** Wrong guesses are counted per account; after OTP_MAX_ATTEMPTS the code is burned. */
export async function consumeOtpCode(redis: Redis, prefix: string, userId: string, code: string) {
  const key = `${prefix}:${userId}`;
  const triesKey = `${prefix}:tries:${userId}`;
  const raw = await redis.get(key);
  if (!raw) return null;
  const data = JSON.parse(raw) as { codeHash: string } & Record<string, string>;
  if (!timingSafeEqualStr(data.codeHash, sha256(code.trim()))) {
    const tries = await redis.incr(triesKey);
    if (tries === 1) await redis.expire(triesKey, 600);
    if (tries >= OTP_MAX_ATTEMPTS) await redis.del(key, triesKey);
    return null;
  }
  const won = await redis.del(key);
  await redis.del(triesKey);
  return won ? data : null;
}
