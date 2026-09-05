import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });
config();

import { Worker, type WorkerOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { z } from 'zod';
import { probeBuffer, withinCap, assertFfprobePath } from './probe.js';

const env = z
  .object({
    REDIS_URL: z.string(),
    API_ORIGIN: z.string().url(),
    INTERNAL_SERVICE_TOKEN: z.string().min(16),
    ALGO_URL: z.string().url(),
    ALGO_SERVICE_TOKEN: z.string().min(16),
    FFPROBE_PATH: z.string().default('ffprobe'),
    SKIP_MEDIA_PROBE: z
      .string()
      .optional()
      .transform((v) => v === 'true' || v === '1'),
    BACKEND_PORT: z.coerce.number().default(4001),
    /** Idle queue poll interval (ms). Default 30s — BullMQ default is 5ms and burns Upstash. */
    REDIS_DRAIN_DELAY_MS: z.coerce.number().default(30_000),
    /** How often to recompute trending without BullMQ repeatables. Default 2h. */
    TRENDING_EVERY_MS: z.coerce.number().default(2 * 60 * 60 * 1000),
  })
  .parse({
    ...process.env,
    BACKEND_PORT: process.env.PORT || process.env.BACKEND_PORT || '4001',
  });

assertFfprobePath(env.FFPROBE_PATH);

function bullConnection() {
  // Each Worker needs its own connection (blocking). Keep ready-check off.
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 5_000,
    keepAlive: 30_000,
  });
}

const lightWorkerOpts: Partial<WorkerOptions> = {
  concurrency: 1,
  drainDelay: env.REDIS_DRAIN_DELAY_MS,
  stalledInterval: 5 * 60_000,
  skipStalledCheck: true,
  lockDuration: 120_000,
};

async function api(path: string, init?: RequestInit) {
  const incoming = new Headers(init?.headers);
  if (!incoming.has('x-request-id')) incoming.set('x-request-id', crypto.randomUUID());
  const res = await fetch(`${env.API_ORIGIN}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.INTERNAL_SERVICE_TOKEN}`,
      'content-type': 'application/json',
      'x-request-id': incoming.get('x-request-id') ?? crypto.randomUUID(),
    },
  });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

const probeWorker = new Worker(
  'media-probe',
  async (job) => {
    if (env.SKIP_MEDIA_PROBE) return;
    const { mediaId, postId } = job.data as { mediaId: string; postId?: string };
    const data = (await api(`/internal/media/${mediaId}`)) as {
      media: { durationCap: number | null };
      downloadUrl: string;
    };
    const buf = Buffer.from(await (await fetch(data.downloadUrl, { signal: AbortSignal.timeout(20_000) })).arrayBuffer());
    if (buf.length < 64) {
      await api(`/internal/media/${mediaId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: 'rejected' }),
      });
      if (postId) {
        await api(`/internal/posts/${postId}/status`, {
          method: 'POST',
          body: JSON.stringify({ status: 'rejected' }),
        });
      }
      return;
    }
    const probed = await probeBuffer(buf, env.FFPROBE_PATH);
    const cap = data.media.durationCap ?? 1800;
    const ok = withinCap(probed.durationMs, cap);
    await api(`/internal/media/${mediaId}/status`, {
      method: 'POST',
      body: JSON.stringify({
        status: ok ? 'ready' : 'rejected',
        durationMs: probed.durationMs,
        sha256: probed.sha256,
      }),
    });
    if (postId) {
      await api(`/internal/posts/${postId}/status`, {
        method: 'POST',
        body: JSON.stringify({
          status: ok ? 'published' : 'rejected',
          durationMs: probed.durationMs,
        }),
      });
    }
  },
  { connection: bullConnection(), ...lightWorkerOpts },
);

const transcribeWorker = new Worker(
  'transcribe',
  async (job) => {
    const { postId, mediaId, caption, draftTranscript } = job.data as {
      postId: string;
      mediaId: string;
      caption: string;
      draftTranscript?: string;
    };
    const data = (await api(`/internal/media/${mediaId}`)) as { downloadUrl: string };
    const res = await fetch(`${env.ALGO_URL}/v1/transcribe`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.ALGO_SERVICE_TOKEN}`,
        'content-type': 'application/json',
        'x-request-id': crypto.randomUUID(),
      },
      body: JSON.stringify({
        post_id: postId,
        caption,
        draft_transcript: draftTranscript ?? '',
        download_url: data.downloadUrl,
      }),
    });
    if (!res.ok) throw new Error(`transcribe ${res.status}`);
    const out = (await res.json()) as { transcript?: string };
    if (out.transcript) {
      await api(`/internal/posts/${postId}/transcript`, {
        method: 'POST',
        body: JSON.stringify({ transcript: out.transcript }),
      });
    }
  },
  { connection: bullConnection(), ...lightWorkerOpts },
);

// Trending: plain timer — no BullMQ Worker/Queue/repeatable (those were Redis-heavy).
async function recomputeTrending() {
  try {
    await fetch(`${env.ALGO_URL}/v1/trending/recompute`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.ALGO_SERVICE_TOKEN}` },
    });
  } catch (err) {
    console.error('trending recompute failed', err);
  }
}
void recomputeTrending();
setInterval(() => void recomputeTrending(), env.TRENDING_EVERY_MS);

const http = await import('node:http');
http
  .createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'backend' }));
  })
  .listen(env.BACKEND_PORT, '0.0.0.0');

probeWorker.on('failed', (job, err) => console.error('probe failed', job?.id, err));
transcribeWorker.on('failed', (job, err) => console.error('transcribe failed', job?.id, err));
console.log(
  `backend workers on :${env.BACKEND_PORT} (drainDelay=${env.REDIS_DRAIN_DELAY_MS}ms trendingEvery=${env.TRENDING_EVERY_MS}ms)`,
);
