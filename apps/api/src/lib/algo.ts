import type { Env } from '../env.js';
import { circuitAllow, circuitFail, circuitOk } from './circuit.js';

export type RankCandidate = {
  post_id: string;
  author_id: string;
  caption: string;
  transcript: string;
  duration_ms: number;
  created_at: string;
  source:
    | 'following'
    | 'fof'
    | 'follower'
    | 'comment_affinity'
    | 'public'
    | 'graph_interact'
    | 'graph_extended'
    | 'listen_author'
    | 'trending'
    | 'share_graph'
    | 'lang_match'
    | 'emotion_match'
    | 'region_match';
  comment_boost: number;
  replay_count?: number;
  share_affinity?: number;
  complete_listen?: number;
  lang?: string;
  emotion?: string;
  region?: string;
  bookmark_affinity?: number;
};

const SOURCE_WEIGHT: Record<RankCandidate['source'], number> = {
  graph_interact: 1.12,
  share_graph: 1.05,
  listen_author: 0.92,
  graph_extended: 0.82,
  following: 0.52,
  comment_affinity: 0.5,
  emotion_match: 0.4,
  fof: 0.46,
  follower: 0.44,
  lang_match: 0.3,
  region_match: 0.32,
  trending: 0.38,
  public: 0.22,
};

function durationScore(durationMs: number, avgListenMs: number) {
  const avg = avgListenMs > 0 ? avgListenMs : 90_000;
  const diff = Math.abs(durationMs - avg) / Math.max(avg, 15_000);
  const similar = Math.exp(-diff * 1.35);
  const shorter = durationMs < avg ? 0.12 : 0.0;
  return Math.min(1, similar + shorter);
}

export function localRank(candidates: RankCandidate[], avgListenMs: number) {
  return [...candidates]
    .map((c, i) => {
      const replay = Math.min(c.replay_count ?? 0, 3) / 3;
      return {
        id: c.post_id,
        score:
          0.36 * (SOURCE_WEIGHT[c.source] ?? 0.2) +
          0.22 * durationScore(c.duration_ms, avgListenMs) +
          0.08 * replay +
          0.08 * (c.share_affinity ?? 0) +
          0.06 * (c.complete_listen ?? 0) +
          0.02 * (1 - i / Math.max(candidates.length, 1)),
      };
    })
    .sort((a, b) => b.score - a.score)
    .map((c) => c.id);
}

function algoHeaders(env: Env, reqId?: string) {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${env.ALGO_SERVICE_TOKEN}`,
    ...(reqId ? { 'x-request-id': reqId } : {}),
  };
}

export async function rankFeed(
  env: Env,
  payload: {
    user_id: string | null;
    candidates: RankCandidate[];
    recent_captions: string[];
    avg_listen_ms: number;
    viewer_emotion?: string;
    viewer_lang?: string;
    viewer_region?: string;
  },
  reqId?: string,
): Promise<string[] | null> {
  if (!circuitAllow('algo')) return null;
  try {
    const res = await fetch(`${env.ALGO_URL}/v1/rank`, {
      method: 'POST',
      headers: algoHeaders(env, reqId),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) {
      circuitFail('algo');
      console.error({ status: res.status, reqId }, 'algo rank failed');
      return null;
    }
    circuitOk('algo');
    const data = (await res.json()) as { post_ids?: string[] };
    return data.post_ids ?? null;
  } catch (err) {
    circuitFail('algo');
    console.error({ err, reqId }, 'algo rank failed');
    return null;
  }
}

export async function rankFeedOrLocal(
  env: Env,
  payload: {
    user_id: string | null;
    candidates: RankCandidate[];
    recent_captions: string[];
    avg_listen_ms: number;
    viewer_emotion?: string;
    viewer_lang?: string;
    viewer_region?: string;
  },
  reqId?: string,
) {
  const remote = await rankFeed(env, payload, reqId);
  if (remote && remote.length) return remote;
  return localRank(payload.candidates, payload.avg_listen_ms);
}

export async function inferGeo(
  env: Env,
  text: string,
  reqId?: string,
): Promise<{ lang: string; region: string }> {
  const empty = { lang: '', region: '' };
  if (!text.trim()) return empty;
  try {
    const res = await fetch(`${env.ALGO_URL}/v1/geo`, {
      method: 'POST',
      headers: algoHeaders(env, reqId),
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(800),
    });
    if (!res.ok) return empty;
    const data = (await res.json()) as { lang?: string; region?: string };
    return { lang: data.lang ?? '', region: data.region ?? '' };
  } catch {
    return empty;
  }
}

export async function fetchTrendingIds(env: Env, reqId?: string): Promise<string[] | null> {
  if (!circuitAllow('algo')) return null;
  try {
    const res = await fetch(`${env.ALGO_URL}/v1/trending`, {
      headers: {
        authorization: `Bearer ${env.ALGO_SERVICE_TOKEN}`,
        ...(reqId ? { 'x-request-id': reqId } : {}),
      },
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) {
      circuitFail('algo');
      console.error({ status: res.status, reqId }, 'algo trending failed');
      return null;
    }
    circuitOk('algo');
    const data = (await res.json()) as { post_ids?: string[] };
    return data.post_ids ?? null;
  } catch (err) {
    circuitFail('algo');
    console.error({ err, reqId }, 'algo trending failed');
    return null;
  }
}
