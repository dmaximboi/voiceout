import type { Env } from '../env.js';

export function assertFlag(env: Env, flag: 'KILL_UPLOADS' | 'KILL_OAUTH' | 'KILL_TRANSCRIBE') {
  if (!env[flag]) return;
  const err = new Error('Temporarily disabled');
  (err as Error & { statusCode?: number }).statusCode = 503;
  throw err;
}
