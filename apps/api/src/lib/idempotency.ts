import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';

export async function withIdempotency<T>(
  redis: Redis,
  req: FastifyRequest,
  reply: FastifyReply,
  run: () => Promise<T>,
): Promise<T> {
  const raw = req.headers['idempotency-key'];
  const key = typeof raw === 'string' ? raw.trim() : '';
  if (!key || key.length < 8 || key.length > 80) return run();
  const cacheKey = `vo:idem:${req.authUser?.id ?? 'anon'}:${key}`;
  const cached = await redis.get(cacheKey);
  if (cached) {
    reply.header('Idempotent-Replay', '1');
    return JSON.parse(cached) as T;
  }
  const result = await run();
  if (reply.statusCode < 400) {
    await redis.set(cacheKey, JSON.stringify(result), 'EX', 60 * 60 * 24, 'NX');
  }
  return result;
}
