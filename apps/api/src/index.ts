import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env'), override: true });
config();

import { createDb } from '@voiceout/db';
import { Redis } from 'ioredis';
import { loadEnv } from './env.js';
import { buildApp } from './app.js';
import { createS3 } from './lib/s3.js';
import { createQueues } from './lib/queue.js';

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 2,
  connectTimeout: 3000,
  commandTimeout: 2500,
  enableOfflineQueue: false,
});
const s3 = createS3(env);
const queues = createQueues(env.REDIS_URL);

const app = await buildApp({ env, db, redis, s3, queues });
await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
