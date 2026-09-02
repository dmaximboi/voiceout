import type { Env } from '../env.js';
import { circuitAllow, circuitFail, circuitOk } from './circuit.js';
import { COMMENT_CATEGORIES, type CommentCategory } from '@voiceout/shared';

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
  prior_share_boost?: number;
  complete_listen?: number;
  lang?: string;
  emotion?: string;
  region?: string;
  bookmark_affinity?: number;
  graph_proximity?: number;
  search_similarity?: number;
  reply_affinity?: number;
  author_familiarity?: number;
  seen_count?: number;
  reaction_affinity?: number;
  comment_affinity?: number;
  repost_affinity?: number;
  voice_affinity?: number;
  category_affinity?: number;
  novelty?: number;
  explore?: boolean;
  premium_badge?: boolean;
  negative_feedback?: number;
  category?: string;
  unique_reach?: number;
  over_reach_cap?: boolean;
};

export type RankResult = { postIds: string[]; rankReasons: Record<string, string[]> };

export type CommentClassification = {
  primary: CommentCategory;
  secondary: CommentCategory | null;
  confidence: number;
};

export const NEUTRAL_CLASSIFICATION: CommentClassification = {
  primary: 'neutral',
  secondary: null,
  confidence: 0,
};

function isCommentCategory(value: unknown): value is CommentCategory {
  return typeof value === 'string' && (COMMENT_CATEGORIES as readonly string[]).includes(value);
}

export function parseCommentClassification(value: unknown): CommentClassification {
  if (!value || typeof value !== 'object') return NEUTRAL_CLASSIFICATION;
  const data = value as Record<string, unknown>;
  if (!isCommentCategory(data.primary)) return NEUTRAL_CLASSIFICATION;
  const confidence =
    typeof data.confidence === 'number' && Number.isFinite(data.confidence)
      ? Math.min(1, Math.max(0, data.confidence))
      : 0;
  return {
    primary: data.primary,
    secondary: isCommentCategory(data.secondary) && data.secondary !== data.primary ? data.secondary : null,
    confidence,
  };
}

const SOURCE_WEIGHT: Record<RankCandidate['source'], number> = {
  graph_interact: 1,
  share_graph: 0.94,
  listen_author: 0.8,
  graph_extended: 0.72,
  following: 0.48,
  comment_affinity: 0.42,
  emotion_match: 0.36,
  fof: 0.4,
  follower: 0.38,
  lang_match: 0.26,
  region_match: 0.28,
  trending: 0.32,
  public: 0.18,
};

export const RANK_FACTOR_WEIGHTS = {
  recency: 0.075,
  source: 0.095,
  'graph proximity': 0.06,
  'duration fit': 0.045,
  'text similarity': 0.05,
  'search similarity': 0.04,
  'comment engagement': 0.035,
  replay: 0.035,
  'language match': 0.03,
  'emotion match': 0.025,
  'region match': 0.02,
  'share affinity': 0.035,
  completion: 0.04,
  'bookmark affinity': 0.03,
  'reply affinity': 0.035,
  'author familiarity': 0.04,
  'seen fatigue': -0.06,
  'reaction affinity': 0.035,
  'comment affinity': 0.035,
  'repost affinity': 0.03,
  'voice affinity': 0.03,
  'time of day': 0.02,
  'category affinity': 0.04,
  novelty: 0.025,
  'explore bonus': 0.02,
  'reach fairness': 0.025,
  'premium badge': 0.005,
  'negative feedback': -0.11,
} as const;

type RankFactorName = keyof typeof RANK_FACTOR_WEIGHTS;

export type RankPayload = {
  user_id: string | null;
  candidates: RankCandidate[];
  recent_captions: string[];
  avg_listen_ms: number;
  viewer_emotion?: string;
  viewer_lang?: string;
  viewer_region?: string;
  follow_edges?: [string, string][];
  user_count?: number;
};

function clamp(value: number, low = 0, high = 1) {
  return Math.min(high, Math.max(low, Number.isFinite(value) ? value : 0));
}

function durationScore(durationMs: number, avgListenMs: number) {
  const avg = avgListenMs > 0 ? avgListenMs : 90_000;
  const diff = Math.abs(durationMs - avg) / Math.max(avg, 15_000);
  const similar = Math.exp(-diff * 1.35);
  const shorter = durationMs < avg ? 0.12 : 0.0;
  return clamp(similar + shorter);
}

function ageAndTimeOfDay(createdAt: string) {
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) return { recency: 0.3, timeOfDay: 0.5 };
  const now = new Date();
  const created = new Date(timestamp);
  const hours = Math.max(0, (now.getTime() - timestamp) / 3_600_000);
  const rawDelta = Math.abs(now.getUTCHours() - created.getUTCHours());
  return {
    recency: Math.exp(-hours / 18),
    timeOfDay: Math.exp(-Math.min(rawDelta, 24 - rawDelta) / 6),
  };
}

function tokenize(text: string) {
  return text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
}

function cosineSimilarity(text: string, recentTexts: string[]) {
  if (!recentTexts.length) return 0;
  const left = new Map<string, number>();
  const right = new Map<string, number>();
  for (const token of tokenize(text)) left.set(token, (left.get(token) ?? 0) + 1);
  for (const token of tokenize(recentTexts.join(' '))) right.set(token, (right.get(token) ?? 0) + 1);
  if (!left.size || !right.size) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const [token, count] of left) {
    dot += count * (right.get(token) ?? 0);
    leftNorm += count * count;
  }
  for (const count of right.values()) rightNorm += count * count;
  return clamp(dot / Math.sqrt(leftNorm * rightNorm));
}

function graphProximity(payload: RankPayload) {
  const proximity = new Map<string, number>();
  if (!payload.user_id || !payload.follow_edges?.length) return proximity;
  const graph = new Map<string, string[]>();
  for (const [from, to] of payload.follow_edges) graph.set(from, [...(graph.get(from) ?? []), to]);
  const queue: Array<[string, number]> = [[payload.user_id, 0]];
  const visited = new Set([payload.user_id]);
  while (queue.length) {
    const [node, distance] = queue.shift()!;
    if (distance >= 3) continue;
    for (const next of graph.get(node) ?? []) {
      if (visited.has(next)) continue;
      const hops = distance + 1;
      visited.add(next);
      proximity.set(next, 1 / hops);
      queue.push([next, hops]);
    }
  }
  return proximity;
}

function softAffinity(candidateValue: string | undefined, viewerValue: string | undefined) {
  if (!candidateValue || !viewerValue) return 0.42;
  return candidateValue === viewerValue ? 1 : 0.12;
}

const REACTION_EMOTION: Record<string, string> = {
  love: 'happy', haha: 'happy', wow: 'surprise', sad: 'sad', angry: 'anger', like: 'neutral',
};

function emotionAffinity(viewerEmotion: string | undefined, postEmotion: string | undefined) {
  const viewer = REACTION_EMOTION[viewerEmotion ?? ''] ?? viewerEmotion ?? '';
  if (!viewer || !postEmotion || viewer === 'neutral' || postEmotion === 'neutral') return 0.35;
  return viewer === postEmotion ? 1 : 0.08;
}

function localFactorValues(c: RankCandidate, payload: RankPayload, proximity: Map<string, number>) {
  const time = ageAndTimeOfDay(c.created_at);
  const uniqueReach = Math.max(0, c.unique_reach ?? 0);
  return {
    recency: time.recency,
    source: SOURCE_WEIGHT[c.source] ?? 0.2,
    'graph proximity': Math.max(clamp(c.graph_proximity ?? 0), proximity.get(c.author_id) ?? 0),
    'duration fit': durationScore(c.duration_ms, payload.avg_listen_ms),
    'text similarity': cosineSimilarity(`${c.caption} ${c.transcript}`, payload.recent_captions),
    'search similarity': clamp(c.search_similarity ?? 0),
    'comment engagement': clamp(0.15 * c.comment_boost),
    replay: clamp(Math.min(Math.max(c.replay_count ?? 0, 0), 3) / 3),
    'language match': softAffinity(c.lang, payload.viewer_lang),
    'emotion match': emotionAffinity(payload.viewer_emotion, c.emotion),
    'region match': softAffinity(c.region, payload.viewer_region),
    'share affinity': clamp((c.share_affinity ?? 0) + 0.04 * (c.prior_share_boost ?? 0)),
    completion: clamp(c.complete_listen ?? 0),
    'bookmark affinity': clamp(c.bookmark_affinity ?? 0),
    'reply affinity': clamp(c.reply_affinity ?? 0),
    'author familiarity': clamp(c.author_familiarity ?? 0),
    'seen fatigue': clamp(Math.log1p(Math.max(0, c.seen_count ?? 0)) / Math.log(6)),
    'reaction affinity': clamp(c.reaction_affinity ?? 0),
    'comment affinity': clamp(c.comment_affinity ?? 0),
    'repost affinity': clamp(c.repost_affinity ?? 0),
    'voice affinity': clamp(c.voice_affinity ?? 0),
    'time of day': time.timeOfDay,
    'category affinity': clamp(c.category_affinity ?? 0),
    novelty: clamp(c.novelty ?? 0.5),
    'explore bonus': c.explore ? 1 : 0,
    'reach fairness': c.over_reach_cap
      ? 0.15
      : uniqueReach < 8 ? 1 : 1 / (1 + uniqueReach / 500),
    'premium badge': c.premium_badge ? 1 : 0,
    'negative feedback': clamp(c.negative_feedback ?? 0),
  } satisfies Record<RankFactorName, number>;
}

export function localRank(payload: RankPayload): RankResult {
  const proximity = graphProximity(payload);
  const scored = payload.candidates
    .map((c) => {
      const factors = localFactorValues(c, payload, proximity);
      const contributions = (Object.keys(RANK_FACTOR_WEIGHTS) as RankFactorName[])
        .map((name) => ({ name, value: factors[name] * RANK_FACTOR_WEIGHTS[name] }));
      return {
        id: c.post_id,
        score: contributions.reduce((sum, factor) => sum + factor.value, 0),
        reasons: contributions.filter((factor) => factor.value > 0)
          .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
          .slice(0, 3)
          .map((factor) => factor.name),
      };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return {
    postIds: scored.map((c) => c.id),
    rankReasons: Object.fromEntries(scored.map((c) => [c.id, c.reasons])),
  };
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
  payload: RankPayload,
  reqId?: string,
): Promise<RankResult | null> {
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
    const data = (await res.json()) as { post_ids?: string[]; rank_reasons?: Record<string, string[]> };
    return data.post_ids ? { postIds: data.post_ids, rankReasons: data.rank_reasons ?? {} } : null;
  } catch (err) {
    circuitFail('algo');
    console.error({ err, reqId }, 'algo rank failed');
    return null;
  }
}

export async function rankFeedOrLocal(
  env: Env,
  payload: RankPayload,
  reqId?: string,
) {
  const remote = await rankFeed(env, payload, reqId);
  if (remote?.postIds.length) return remote;
  return localRank(payload);
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

export async function classifyComment(
  env: Env,
  body: string,
  stickerId?: string | null,
  reqId?: string,
): Promise<CommentClassification> {
  if (!body.trim() && !stickerId) return NEUTRAL_CLASSIFICATION;
  try {
    const res = await fetch(`${env.ALGO_URL}/v1/classify`, {
      method: 'POST',
      headers: algoHeaders(env, reqId),
      body: JSON.stringify({ body, sticker_id: stickerId ?? null }),
      signal: AbortSignal.timeout(700),
    });
    if (!res.ok) return NEUTRAL_CLASSIFICATION;
    return parseCommentClassification(await res.json());
  } catch {
    return NEUTRAL_CLASSIFICATION;
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
