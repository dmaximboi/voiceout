import { Queue, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';

export type ProbeJob = { mediaId: string; postId?: string; commentId?: string };
export type TranscribeJob = { postId: string; mediaId: string; caption: string; draftTranscript?: string };

/** Shared ioredis options that avoid Upstash-burning heartbeats. */
export function redisBaseOpts(extra?: { maxRetriesPerRequest: number | null }) {
  return {
    maxRetriesPerRequest: extra?.maxRetriesPerRequest ?? 2,
    enableReadyCheck: false,
    enableOfflineQueue: false,
    connectTimeout: 5_000,
    // Keep idle TCP quiet; Upstash counts every command.
    keepAlive: 30_000,
  } as const;
}

export const defaultJobOpts: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  // Tiny history — completed/failed job keys still count as Redis commands/keys.
  removeOnComplete: 10,
  removeOnFail: 30,
};

export function createQueues(redisUrl: string) {
  // Producer-only connection (API). Do not open a Worker here.
  const connection = new Redis(redisUrl, redisBaseOpts({ maxRetriesPerRequest: null }));
  const opts = { connection, defaultJobOptions: defaultJobOpts };
  return {
    connection,
    mediaProbe: new Queue<ProbeJob>('media-probe', opts),
    transcribe: new Queue<TranscribeJob>('transcribe', opts),
  };
}

/** Enqueue without getWaitingCount (that alone was an extra Redis round-trip per upload). */
export async function enqueue(queue: Queue, name: string, data: object) {
  return queue.add(name, data, defaultJobOpts);
}

export type Queues = ReturnType<typeof createQueues>;
