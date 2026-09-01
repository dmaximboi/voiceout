import type { FastifyInstance } from 'fastify';
import { blocks, bookmarks, comments, follows, listenEvents, mutes, postReactions, posts, reposts, seenPosts, shareClicks, trendingSnapshots, users, voices } from '@voiceout/db';
import { and, desc, eq, inArray, notInArray, or, sql } from 'drizzle-orm';
import { fetchTrendingIds, rankFeedOrLocal, type RankCandidate } from '../lib/algo.js';
import { hydratePosts } from '../lib/hydrate.js';
import { listenSchema } from '@voiceout/shared';
import { requireCsrf } from '../plugins/auth.js';
import { z } from 'zod';

export async function feedRoutes(app: FastifyInstance) {
  app.get('/feed', async (req) => {
    const viewer = req.authUser?.id ?? null;
    const limit = 40;
    if (!viewer) {
      return { posts: [], mode: 'guest' };
    }

    const blocked = await blockedIds(app, viewer);
    const muted = await mutedIds(app, viewer);
    const excludeAuthors = [...new Set([...blocked, ...muted])];

    const [followingRows, followerRows, shareAuthorIds, stats, viewerHints, lastReact, ownEmotion, bookmarkedAuthors] =
      await Promise.all([
        app.db.select({ id: follows.followeeId }).from(follows).where(eq(follows.followerId, viewer)),
        app.db.select({ id: follows.followerId }).from(follows).where(eq(follows.followeeId, viewer)),
        shareGraphAuthors(app, viewer),
        listenStats(app, viewer),
        viewerGeoHints(app, viewer),
        lastReaction(app, viewer),
        ownPostEmotion(app, viewer),
        bookmarkedAuthorIds(app, viewer),
      ]);
    const followingIds = followingRows.map((f) => f.id);
    const followerIds = followerRows.map((f) => f.id);
    const avgListenMs = stats.avgListenMs;
    const listenAuthorIds = stats.listenAuthorIds;

    const [fofIds, graphInteractIds, trendIds] = await Promise.all([
      followingIds.length
        ? app.db
            .select({ id: follows.followeeId })
            .from(follows)
            .where(inArray(follows.followerId, followingIds))
            .then((rows) =>
              [...new Set(rows.map((r) => r.id))].filter((id) => id !== viewer && !followingIds.includes(id)),
            )
        : Promise.resolve([] as string[]),
      followeeInteractedAuthors(app, viewer, followingIds),
      fetchTrendingIds(app.env, req.id).then((ids) => ids ?? []),
    ]);

    const sourceByAuthor = new Map<string, RankCandidate['source']>();
    function tag(ids: string[], source: RankCandidate['source']) {
      for (const id of ids) {
        if (!sourceByAuthor.has(id)) sourceByAuthor.set(id, source);
      }
    }
    tag(graphInteractIds, 'graph_interact');
    tag(shareAuthorIds, 'share_graph');
    tag(listenAuthorIds, 'listen_author');
    tag(followingIds, 'following');
    tag(fofIds, 'fof');
    tag(followerIds, 'follower');

    const candidates: RankCandidate[] = [];
    const seen = new Set<string>();

    function push(p: typeof posts.$inferSelect, source: RankCandidate['source'], extra = 0) {
      if (seen.has(p.id) || excludeAuthors.includes(p.authorId)) return;
      seen.add(p.id);
      candidates.push({
        post_id: p.id,
        author_id: p.authorId,
        caption: p.caption,
        transcript: p.transcript ?? '',
        duration_ms: p.durationMs,
        created_at: p.createdAt.toISOString(),
        source,
        comment_boost: extra,
        lang: p.lang ?? '',
        emotion: p.commentEmotion ?? '',
        region: p.region ?? '',
      });
    }

    const authorIds = [...sourceByAuthor.keys()].filter((id) => !excludeAuthors.includes(id));
    if (authorIds.length) {
      const rows = await app.db
        .select()
        .from(posts)
        .where(and(eq(posts.status, 'published'), inArray(posts.authorId, authorIds)))
        .orderBy(desc(posts.createdAt))
        .limit(80);
      for (const p of rows) push(p, sourceByAuthor.get(p.authorId) ?? 'public');
    }

    if (candidates.length < 15) {
      const rows = await app.db
        .select()
        .from(posts)
        .where(
          and(
            eq(posts.status, 'published'),
            excludeAuthors.length ? notInArray(posts.authorId, excludeAuthors) : sql`true`,
          ),
        )
        .orderBy(desc(posts.createdAt))
        .limit(40);
      for (const p of rows) push(p, 'public');
    }

    if (trendIds.length) {
      const rows = await app.db.select().from(posts).where(inArray(posts.id, trendIds));
      for (const p of rows) push(p, 'trending');
    }

    const viewerLang = viewerHints.lang || (await viewerLangHint(app, viewer));
    const viewerRegion = viewerHints.region;
    const reactionEmotion = REACTION_TO_SENTIMENT[lastReact] ?? '';
    const matchEmotions = [...new Set([reactionEmotion, ownEmotion].filter((e) => Boolean(e) && e !== 'neutral'))];
    const viewerEmotion = reactionEmotion && reactionEmotion !== 'neutral' ? lastReact : ownEmotion;

    await pullMatched(app, {
      seen,
      candidates,
      excludeAuthors,
      lang: viewerLang,
      region: viewerRegion,
      emotions: matchEmotions,
    });

    const [recentCaptions, replay, completes] = await Promise.all([
      recentEngagedCaptions(app, viewer),
      replayCounts(app, viewer, [...seen]),
      personalCompletes(app, viewer, [...seen]),
    ]);
    const shareSet = new Set(shareAuthorIds);
    const bookmarkSet = new Set(bookmarkedAuthors);
    for (const c of candidates) {
      c.replay_count = Math.min(replay.get(c.post_id) ?? 0, 3);
      c.complete_listen = completes.has(c.post_id) ? 1 : 0;
      c.share_affinity = shareSet.has(c.author_id) ? 1 : 0;
      c.bookmark_affinity = bookmarkSet.has(c.author_id) ? 1 : 0;
    }
    const rankedIds = await rankFeedOrLocal(app.env, {
      user_id: viewer,
      candidates,
      recent_captions: recentCaptions,
      avg_listen_ms: avgListenMs,
      viewer_emotion: viewerEmotion,
      viewer_lang: viewerLang,
      viewer_region: viewerRegion,
    }, req.id);

    const order = rankedIds && rankedIds.length ? rankedIds : candidates.map((c) => c.post_id);
    const idList = order.slice(0, limit);
    if (idList.length === 0) return { posts: [], mode: 'personalized' };
    const rows = await app.db.select().from(posts).where(inArray(posts.id, idList));
    const map = new Map(rows.map((r) => [r.id, r]));
    const ordered = idList.map((id) => map.get(id)).filter(Boolean) as typeof rows;
    return { posts: await hydratePosts(app.db, app.env, app.s3, ordered, viewer), mode: 'personalized' };
  });

  app.post('/feed/listen', async (req, reply) => {
    if (!req.authUser) return { ok: true };
    requireCsrf(req);
    const body = listenSchema.parse(req.body);
    const [post] = await app.db.select({ id: posts.id }).from(posts).where(eq(posts.id, body.postId)).limit(1);
    if (!post) return reply.code(404).send({ error: 'Not found' });
    await app.db.insert(listenEvents).values({
      userId: req.authUser.id,
      postId: body.postId,
      listenedMs: body.listenedMs,
      durationMs: body.durationMs ?? null,
    });
    return { ok: true };
  });

  app.post('/feed/seen', async (req) => {
    if (!req.authUser) return { ok: true };
    requireCsrf(req);
    const body = z.object({ postIds: z.array(z.string().uuid()).max(50) }).parse(req.body);
    if (body.postIds.length === 0) return { ok: true };
    await app.db
      .insert(seenPosts)
      .values(body.postIds.map((postId) => ({ userId: req.authUser!.id, postId })))
      .onConflictDoNothing();
    return { ok: true };
  });

  app.get('/trending', async (req) => {
    if (!req.authUser) return { posts: [] };
    let ids = await fetchTrendingIds(app.env, req.id);
    if (!ids || ids.length === 0) {
      const [snap] = await app.db
        .select()
        .from(trendingSnapshots)
        .orderBy(desc(trendingSnapshots.computedAt))
        .limit(1);
      ids = snap?.postIds ?? [];
    }
    if (!ids.length) {
      const rows = await app.db
        .select()
        .from(posts)
        .where(eq(posts.status, 'published'))
        .orderBy(desc(posts.createdAt))
        .limit(20);
      return { posts: await hydratePosts(app.db, app.env, app.s3, rows, req.authUser?.id ?? null) };
    }
    const rows = await app.db.select().from(posts).where(inArray(posts.id, ids));
    const map = new Map(rows.map((r) => [r.id, r]));
    const ordered = ids.map((id) => map.get(id)).filter(Boolean) as typeof rows;
    return { posts: await hydratePosts(app.db, app.env, app.s3, ordered, req.authUser?.id ?? null) };
  });
}

async function blockedIds(app: FastifyInstance, userId: string) {
  const rows = await app.db.select().from(blocks).where(eq(blocks.blockerId, userId));
  const other = await app.db.select().from(blocks).where(eq(blocks.blockedId, userId));
  return [...rows.map((r) => r.blockedId), ...other.map((r) => r.blockerId)];
}

async function mutedIds(app: FastifyInstance, userId: string) {
  const rows = await app.db.select().from(mutes).where(eq(mutes.muterId, userId));
  return rows.map((r) => r.mutedId);
}

async function listenStats(app: FastifyInstance, userId: string) {
  const rows = await app.db
    .select({
      listenedMs: listenEvents.listenedMs,
      postId: listenEvents.postId,
    })
    .from(listenEvents)
    .where(eq(listenEvents.userId, userId))
    .orderBy(desc(listenEvents.createdAt))
    .limit(40);
  const avgListenMs =
    rows.length > 0 ? Math.round(rows.reduce((a, r) => a + r.listenedMs, 0) / rows.length) : 90_000;
  const postIds = [...new Set(rows.map((r) => r.postId))];
  let listenAuthorIds: string[] = [];
  if (postIds.length) {
    const authors = await app.db
      .select({ authorId: posts.authorId })
      .from(posts)
      .where(inArray(posts.id, postIds));
    listenAuthorIds = [...new Set(authors.map((a) => a.authorId))].filter((id) => id !== userId);
  }
  return { avgListenMs, listenAuthorIds };
}

/** Authors that people you follow recently liked, commented, reposted, or voiced. */
async function followeeInteractedAuthors(app: FastifyInstance, viewer: string, followingIds: string[]) {
  if (followingIds.length === 0) return [];
  const [reacted, commented, reposted, voiced] = await Promise.all([
    app.db
      .select({ authorId: posts.authorId })
      .from(postReactions)
      .innerJoin(posts, eq(posts.id, postReactions.postId))
      .where(inArray(postReactions.userId, followingIds))
      .orderBy(desc(postReactions.createdAt))
      .limit(80),
    app.db
      .select({ authorId: posts.authorId })
      .from(comments)
      .innerJoin(posts, eq(posts.id, comments.postId))
      .where(inArray(comments.authorId, followingIds))
      .orderBy(desc(comments.createdAt))
      .limit(80),
    app.db
      .select({ authorId: posts.authorId })
      .from(reposts)
      .innerJoin(posts, eq(posts.id, reposts.postId))
      .where(inArray(reposts.userId, followingIds))
      .orderBy(desc(reposts.createdAt))
      .limit(80),
    app.db
      .select({ authorId: posts.authorId })
      .from(voices)
      .innerJoin(posts, eq(posts.id, voices.postId))
      .where(inArray(voices.userId, followingIds))
      .orderBy(desc(voices.createdAt))
      .limit(80),
  ]);
  return [
    ...new Set(
      [...reacted, ...commented, ...reposted, ...voiced]
        .map((r) => r.authorId)
        .filter((id) => id !== viewer && !followingIds.includes(id)),
    ),
  ];
}

async function recentEngagedCaptions(app: FastifyInstance, userId: string) {
  const reacted = await app.db
    .select({ caption: posts.caption, transcript: posts.transcript })
    .from(posts)
    .innerJoin(postReactions, eq(postReactions.postId, posts.id))
    .where(eq(postReactions.userId, userId))
    .orderBy(desc(postReactions.createdAt))
    .limit(20);
  const commented = await app.db
    .select({ caption: posts.caption, transcript: posts.transcript })
    .from(posts)
    .innerJoin(comments, eq(comments.postId, posts.id))
    .where(eq(comments.authorId, userId))
    .orderBy(desc(comments.createdAt))
    .limit(20);
  return [...reacted, ...commented]
    .map((r) => [r.caption, r.transcript ?? ''].filter(Boolean).join(' '))
    .slice(0, 30);
}

async function shareGraphAuthors(app: FastifyInstance, viewer: string) {
  const [asSharer, asClicker] = await Promise.all([
    app.db
      .select({ id: shareClicks.clickerId })
      .from(shareClicks)
      .where(eq(shareClicks.sharerId, viewer))
      .limit(80),
    app.db
      .select({ id: shareClicks.sharerId })
      .from(shareClicks)
      .where(eq(shareClicks.clickerId, viewer))
      .limit(80),
  ]);
  return [...new Set([...asSharer, ...asClicker].map((r) => r.id).filter((id) => id !== viewer))];
}

async function replayCounts(app: FastifyInstance, viewer: string, postIds: string[]) {
  const map = new Map<string, number>();
  if (postIds.length === 0) return map;
  const rows = await app.db
    .select({
      postId: listenEvents.postId,
      n: sql<number>`count(*)::int`,
    })
    .from(listenEvents)
    .where(and(eq(listenEvents.userId, viewer), inArray(listenEvents.postId, postIds)))
    .groupBy(listenEvents.postId);
  for (const row of rows) map.set(row.postId, row.n);
  return map;
}

async function personalCompletes(app: FastifyInstance, viewer: string, postIds: string[]) {
  if (postIds.length === 0) return new Set<string>();
  const rows = await app.db
    .select({ postId: listenEvents.postId })
    .from(listenEvents)
    .where(
      and(
        eq(listenEvents.userId, viewer),
        inArray(listenEvents.postId, postIds),
        sql`${listenEvents.durationMs} > 0 and ${listenEvents.listenedMs} >= ${listenEvents.durationMs} * 0.85`,
      ),
    );
  return new Set(rows.map((r) => r.postId));
}

async function lastReaction(app: FastifyInstance, viewer: string) {
  const [row] = await app.db
    .select({ type: postReactions.type })
    .from(postReactions)
    .where(eq(postReactions.userId, viewer))
    .orderBy(desc(postReactions.createdAt))
    .limit(1);
  return row?.type ?? '';
}

const REACTION_TO_SENTIMENT: Record<string, string> = {
  like: 'neutral',
  love: 'happy',
  haha: 'happy',
  wow: 'surprise',
  sad: 'sad',
  angry: 'anger',
};

async function viewerGeoHints(app: FastifyInstance, viewer: string) {
  const [row] = await app.db
    .select({ lang: users.lang, region: users.region })
    .from(users)
    .where(eq(users.id, viewer))
    .limit(1);
  return { lang: row?.lang?.trim() ?? '', region: row?.region?.trim() ?? '' };
}

async function bookmarkedAuthorIds(app: FastifyInstance, viewer: string) {
  const rows = await app.db
    .select({ authorId: posts.authorId })
    .from(bookmarks)
    .innerJoin(posts, eq(posts.id, bookmarks.postId))
    .where(eq(bookmarks.userId, viewer))
    .limit(80);
  return [...new Set(rows.map((r) => r.authorId).filter((id) => id !== viewer))];
}

async function viewerLangHint(app: FastifyInstance, viewer: string) {
  const rows = await app.db
    .select({ lang: posts.lang })
    .from(posts)
    .where(and(eq(posts.authorId, viewer), eq(posts.status, 'published')))
    .orderBy(desc(posts.createdAt))
    .limit(8);
  const counts = new Map<string, number>();
  for (const row of rows) {
    const lang = row.lang?.trim();
    if (!lang) continue;
    counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  let best = '';
  let n = 0;
  for (const [lang, count] of counts) {
    if (count > n) {
      best = lang;
      n = count;
    }
  }
  return best;
}

async function ownPostEmotion(app: FastifyInstance, viewer: string) {
  const [row] = await app.db
    .select({ emotion: posts.commentEmotion })
    .from(posts)
    .where(and(eq(posts.authorId, viewer), eq(posts.status, 'published')))
    .orderBy(desc(posts.createdAt))
    .limit(1);
  const emotion = row?.emotion?.trim() ?? '';
  return emotion && emotion !== 'neutral' ? emotion : '';
}

async function pullMatched(
  app: FastifyInstance,
  opts: {
    seen: Set<string>;
    candidates: RankCandidate[];
    excludeAuthors: string[];
    lang: string;
    region: string;
    emotions: string[];
  },
) {
  const matchers = [
    opts.lang ? eq(posts.lang, opts.lang) : null,
    opts.region ? eq(posts.region, opts.region) : null,
    opts.emotions.length ? inArray(posts.commentEmotion, opts.emotions) : null,
  ].filter(Boolean) as ReturnType<typeof eq>[];
  if (matchers.length === 0) return;
  const rows = await app.db
    .select()
    .from(posts)
    .where(and(eq(posts.status, 'published'), or(...matchers)))
    .orderBy(desc(posts.createdAt))
    .limit(40);
  for (const p of rows) {
    if (opts.seen.has(p.id) || opts.excludeAuthors.includes(p.authorId)) continue;
    opts.seen.add(p.id);
    const source: RankCandidate['source'] =
      opts.lang && p.lang === opts.lang
        ? 'lang_match'
        : opts.region && p.region === opts.region
          ? 'region_match'
          : 'emotion_match';
    opts.candidates.push({
      post_id: p.id,
      author_id: p.authorId,
      caption: p.caption,
      transcript: p.transcript ?? '',
      duration_ms: p.durationMs,
      created_at: p.createdAt.toISOString(),
      source,
      comment_boost: 0,
      lang: p.lang ?? '',
      emotion: p.commentEmotion ?? '',
      region: p.region ?? '',
    });
  }
}
