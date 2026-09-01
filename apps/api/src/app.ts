import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { HttpError } from './lib/http.js';
import type { Env } from './env.js';
import type { Db } from '@voiceout/db';
import type { Redis } from 'ioredis';
import type { S3Client } from '@aws-sdk/client-s3';
import type { Queues } from './lib/queue.js';
import { authPlugin } from './plugins/auth.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { mediaRoutes } from './routes/media.js';
import { postRoutes } from './routes/posts.js';
import { feedRoutes } from './routes/feed.js';
import { notificationRoutes } from './routes/notifications.js';
import { socialRoutes } from './routes/social.js';
import { adminRoutes } from './routes/admin.js';
import './types.js';

export async function buildApp(opts: {
  env: Env;
  db: Db;
  redis: Redis;
  s3: S3Client;
  queues: Queues;
}) {
  const app = Fastify({
    logger: true,
    trustProxy: true,
    bodyLimit: 1_048_576,
    connectionTimeout: 0,
    requestTimeout: 120_000,
    keepAliveTimeout: 15_000,
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      if (typeof incoming === 'string' && incoming.length >= 8 && incoming.length <= 80) return incoming;
      return randomUUID();
    },
  });

  app.decorate('env', opts.env);
  app.decorate('db', opts.db);
  app.decorate('redis', opts.redis);
  app.decorate('s3', opts.s3);
  app.decorate('queues', opts.queues);

  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
  await app.register(cors, {
    origin: [...new Set([opts.env.WEB_ORIGIN, opts.env.PUBLIC_ORIGIN].filter((o) => o.startsWith('http')))],
    credentials: true,
    allowedHeaders: ['content-type', 'x-csrf-token', 'authorization', 'idempotency-key', 'x-request-id'],
  });
  await app.register(cookie, { secret: opts.env.COOKIE_SECRET });
  await app.register(rateLimit, {
    max: 90,
    timeWindow: '1 minute',
    redis: opts.redis,
    nameSpace: 'vo-rl-',
    skipOnError: false,
    ban: 4,
    allowList: (req) => req.url.split('?')[0] === '/health',
  });

  await authPlugin(app);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      req.log.warn({ err }, 'invalid input');
      return reply.code(400).send({ error: 'Invalid input', details: err.flatten() });
    }
    if (err instanceof HttpError) {
      req.log.warn({ err, status: err.statusCode }, err.message);
      if (typeof err.extra.retryAfter === 'number') {
        reply.header('retry-after', String(err.extra.retryAfter));
      }
      return reply.code(err.statusCode).send({ error: err.message, ...err.extra });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    else req.log.warn({ err, status }, err instanceof Error ? err.message : 'request error');
    const message = err instanceof Error ? err.message : 'Error';
    return reply.code(status).send({ error: status === 500 ? 'Server error' : message });
  });

  app.get('/health', async () => ({ ok: true, service: 'api' }));

  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(mediaRoutes);
  await app.register(postRoutes);
  await app.register(feedRoutes);
  await app.register(notificationRoutes);
  await app.register(socialRoutes);
  await app.register(adminRoutes);

  return app;
}
