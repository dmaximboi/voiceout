import { Queue, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';

export type ProbeJob = { mediaId: string; postId?: string; commentId?: string };
export type TranscribeJob = { postId: string; mediaId: string; caption: string; draftTranscript?: string };

const MAX_WAITING = 200;

export const defaultJobOpts: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: 100,
  removeOnFail: 500,
};

export function createQueues(redisUrl: string) {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const opts = { connection, defaultJobOptions: defaultJobOpts };
  return {
    connection,
    mediaProbe: new Queue<ProbeJob>('media-probe', opts),
    transcribe: new Queue<TranscribeJob>('transcribe', opts),
    trending: new Queue('trending', opts),
  };
}

export async function enqueue(queue: Queue, name: string, data: object) {
  const waiting = await queue.getWaitingCount();
  if (waiting > MAX_WAITING) {
    const err = new Error('Busy, try later');
    (err as Error & { statusCode?: number }).statusCode = 503;
    throw err;
  }
  return queue.add(name, data, defaultJobOpts);
}

export type Queues = ReturnType<typeof createQueues>;
