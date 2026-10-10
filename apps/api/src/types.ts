import type { Db, SqlClient } from '@voiceout/db';
import type { S3Client } from '@aws-sdk/client-s3';
import type { Redis } from 'ioredis';
import type { Env } from './env.js';
import type { Queues } from './lib/queue.js';
import type { RequestTx } from './lib/requestDb.js';

export type AuthUser = {
  id: string;
  handle: string;
  email: string;
  sid: string;
  role: 'user' | 'moderator' | 'admin';
  isVerifiedIdentity: boolean;
  planTier: import('@voiceout/shared').PlanTier | null;
  /** @deprecated use planTier */
  isStudio: boolean;
};

declare module 'fastify' {
  interface FastifyInstance {
    env: Env;
    db: Db;
    sql: SqlClient;
    redis: Redis;
    s3: S3Client;
    queues: Queues;
  }
  interface FastifyRequest {
    authUser: AuthUser | null;
    voTx?: RequestTx;
  }
}
