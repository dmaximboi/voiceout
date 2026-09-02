import type { FastifyInstance } from 'fastify';
import { blocks, bookmarks, comments, feedFeedback, follows, listenEvents, mutes, postReactions, posts, reposts, searchQueries, seenPosts, shareClicks, trendingSnapshots, userEvents, users, voices } from '@voiceout/db';
import { and, desc, eq, inArray, notInArray, or, sql } from 'drizzle-orm';
import { fetchTrendingIds, rankFeedOrLocal, type RankCandidate } from '../lib/algo.js';
import { hydratePosts } from '../lib/hydrate.js';
import { feedEventsSchema, feedFeedbackSchema, listenSchema } from '@voiceout/shared';
import { requireAuth, requireCsrf } from '../plugins/auth.js';
import { z } from 'zod';

export async function feedRoutes(app: FastifyInstance) {
  app.get('/feed', async (req) => {
    const viewer = req.authUser?.id ?? null;
    const limit = 40;
    const fast = String((req.query as { fast?: string }).fast ?? '') === '1';
    if (!viewer) {
      const recent = await app.db
        .select()
        .from(posts)
        .where(eq(posts.status, 'published'))
        .orderBy(desc(posts.createdAt))
        .limit(80);
      const selected = diversifyGuestPosts(recent, limit);
      return {
        posts: (await hydratePosts(app.db, app.env, app.s3, selected, null)).map((post) => ({
          ...post,
          rankReasons: [],
        })),
        mode: 'guest',
      };
    }

    if (fast) {
      const blocked = await blockedIds(app, viewer);
      const muted = await mutedIds(app, viewer);
      const excludeAuthors = [...new Set([...blocked, ...muted])];
      const recent = await app.db
        .select()
        .from(posts)
        .where(
          and(
            eq(posts.status, 'published'),
            excludeAuthors.length ? notInArray(posts.authorId, excludeAuthors) : sql`true`,
          ),
        )
        .orderBy(desc(posts.createdAt))
        .limit(limit);
      return {
        posts: (await hydratePosts(app.db, app.env, app.s3, recent, viewer)).map((post) => ({
          ...post,
          rankReasons: [],
        })),
        mode: 'fast',
      };
    }

    const [blocked, muted, feedbackRows, seenRows] = await Promise.all([
      blockedIds(app, viewer),
      mutedIds(app, viewer),
      app.db.select().from(feedFeedback).where(eq(feedFeedback.userId, viewer)),
      app.db
        .select({ postId: seenPosts.postId })
        .from(seenPosts)
        .where(eq(seenPosts.userId, viewer))
        .orderBy(desc(seenPosts.seenAt))
        .limit(1000),
    ]);
    const hiddenAuthors = feedbackRows
      .filter((row) => row.kind === 'hide_author')
      .map((row) => row.authorId);
    const excludeAuthors = [...new Set([...blocked, ...muted, ...hiddenAuthors])];
    const excludedPosts = new Set(
      feedbackRows.filter((row) => row.kind === 'not_interested').map((row) => row.postId),
    );

    const [followingRows, followerRows, shareAuthorIds, stats, viewerHints, lastReact, ownEmotion, bookmarkedAuthors, userCount] =
      await Promise.all([
        app.db.select({ id: follows.followeeId }).from(follows).where(eq(follows.followerId, viewer)),
        app.db.select({ id: follows.followerId }).from(follows).where(eq(follows.followeeId, viewer)),
        shareGraphAuthors(app, viewer),
        listenStats(app, viewer),
        viewerGeoHints(app, viewer),
        lastReaction(app, viewer),
        ownPostEmotion(app, viewer),
        bookmarkedAuthorIds(app, viewer),
        activeUserCount(app),
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
    const seen = new Set<string>([...seenRows.map((row) => row.postId), ...excludedPosts]);

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
        category: Object.entries(p.commentCategories ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '',
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

    if (candidates.length < 40) {
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
        .limit(80);
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

    const candidateIds = candidates.map((candidate) => candidate.post_id);
    const [recentCaptions, recentSearches, replay, completes, personal] = await Promise.all([
      recentEngagedCaptions(app, viewer),
      recentSearchTexts(app, viewer),
      replayCounts(app, viewer, [...seen]),
      personalCompletes(app, viewer, [...seen]),
      personalizationSignals(app, viewer, candidateIds),
    ]);
    const shareSet = new Set(shareAuthorIds);
    const bookmarkSet = new Set(bookmarkedAuthors);
    for (const c of candidates) {
      c.replay_count = Math.min(replay.get(c.post_id) ?? 0, 3);
      c.complete_listen = completes.has(c.post_id) ? 1 : 0;
      c.share_affinity = shareSet.has(c.author_id) ? 1 : 0;
      c.bookmark_affinity = bookmarkSet.has(c.author_id) ? 1 : 0;
      c.search_similarity = tokenSimilarity(`${c.caption} ${c.transcript}`, recentSearches);
      c.reply_affinity = personal.replyAuthors.has(c.author_id) ? 1 : 0;
      c.author_familiarity = Math.min(1, (personal.authorEvents.get(c.author_id) ?? 0) / 5);
      c.reaction_affinity = personal.reacted.has(c.post_id) ? 1 : 0;
      c.comment_affinity = personal.commented.has(c.post_id) ? 1 : 0;
      c.repost_affinity = personal.reposted.has(c.post_id) ? 1 : 0;
      c.voice_affinity = personal.voiced.has(c.post_id) ? 1 : 0;
      c.category_affinity = personal.categories.get(c.category ?? '') ?? 0;
      c.novelty = c.author_familiarity > 0 ? 0.25 : 1;
      c.seen_count = personal.seenCounts.get(c.post_id) ?? 0;
    }
    const exploreIds = deterministicExploreIds(candidates);
    for (const candidate of candidates) candidate.explore = exploreIds.has(candidate.post_id);
    const ranked = await rankFeedOrLocal(app.env, {
      user_id: viewer,
      candidates,
      recent_captions: [...recentCaptions, ...recentSearches].slice(0, 40),
      avg_listen_ms: avgListenMs,
      viewer_emotion: viewerEmotion,
      viewer_lang: viewerLang,
      viewer_region: viewerRegion,
      follow_edges: [
        ...followingIds.map((id) => [viewer, id] as [string, string]),
        ...fofIds.map((id) => [followingIds[0] ?? viewer, id] as [string, string]),
      ],
      user_count: userCount,
    }, req.id);

    let order = injectExploration(ranked.postIds, exploreIds);
    // Never wipe a populated candidate pool if the ranker returns nothing.
    if (order.length === 0 && candidates.length > 0) {
      order = candidates.map((c) => c.post_id);
    }
    const idList = order.slice(0, limit);
    if (idList.length === 0) return { posts: [], mode: 'personalized' };
    const rows = await app.db.select().from(posts).where(inArray(posts.id, idList));
    const map = new Map(rows.map((r) => [r.id, r]));
    const ordered = idList.map((id) => map.get(id)).filter(Boolean) as typeof rows;
    const hydrated = await hydratePosts(app.db, app.env, app.s3, ordered, viewer);
    return {
      posts: hydrated.map((post) => ({
        ...post,
        rankReasons: ranked.rankReasons[post.id] ?? [],
      })),
      mode: 'personalized',
    };
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

  app.post('/feed/feedback', async (req, reply) => {
    requireAuth(req, reply);
    requireCsrf(req);
    const body = feedFeedbackSchema.parse(req.body);
    const [post] = await app.db
      .select({ id: posts.id, authorId: posts.authorId, status: posts.status })
      .from(posts)
      .where(eq(posts.id, body.postId))
      .limit(1);
    if (!post || post.status !== 'published') return reply.code(404).send({ error: 'Not found' });
    if (post.authorId === req.authUser!.id) {
      return reply.code(400).send({ error: 'Cannot give feedback on your own post' });
    }
    const inserted = await app.db
      .insert(feedFeedback)
      .values({
        userId: req.authUser!.id,
        postId: post.id,
        authorId: post.authorId,
        kind: body.kind,
      })
      .onConflictDoNothing()
      .returning({ createdAt: feedFeedback.createdAt });
    const createdAt =
      inserted[0]?.createdAt ??
      (
        await app.db
          .select({ createdAt: feedFeedback.createdAt })
          .from(feedFeedback)
          .where(
            and(
              eq(feedFeedback.userId, req.authUser!.id),
              eq(feedFeedback.postId, post.id),
              eq(feedFeedback.kind, body.kind),
            ),
          )
          .limit(1)
      )[0]?.createdAt;
    return {
      feedback: {
        postId: post.id,
        authorId: post.authorId,
        kind: body.kind,
        createdAt: (createdAt ?? new Date()).toISOString(),
      },
    };
  });

  app.delete('/feed/feedback', async (req, reply) => {
    requireAuth(req, reply);
    requireCsrf(req);
    const body = feedFeedbackSchema.parse(req.body);
    const [post] = await app.db
      .select({ authorId: posts.authorId })
      .from(posts)
      .where(eq(posts.id, body.postId))
      .limit(1);
    if (!post) return reply.code(404).send({ error: 'Not found' });
    await app.db
      .delete(feedFeedback)
      .where(
        and(
          eq(feedFeedback.userId, req.authUser!.id),
          eq(feedFeedback.kind, body.kind),
          body.kind === 'hide_author'
            ? eq(feedFeedback.authorId, post.authorId)
            : eq(feedFeedback.postId, body.postId),
        ),
      );
    return { ok: true };
  });

  app.post('/feed/events', async (req, reply) => {
    requireAuth(req, reply);
    requireCsrf(req);
    const body = feedEventsSchema.parse(req.body);
    const postIds = [...new Set(body.events.flatMap((event) => (event.postId ? [event.postId] : [])))];
    if (postIds.length) {
      const existing = await app.db
        .select({ id: posts.id })
        .from(posts)
        .where(and(inArray(posts.id, postIds), eq(posts.status, 'published')));
      if (existing.length !== postIds.length) return reply.code(400).send({ error: 'Invalid event post' });
    }
    await app.db.insert(userEvents).values(
      body.events.map((event) => ({
        userId: req.authUser!.id,
        eventType: event.eventType,
        postId: event.postId ?? null,
        commentId: event.commentId ?? null,
        targetUserId: event.targetUserId ?? null,
        source: event.source ?? null,
        dwellMs: event.dwellMs ?? null,
      })),
    );
    const seenIds = [
      ...new Set(
        body.events
          .filter((event) => event.eventType === 'seen' || event.eventType === 'impression')
          .flatMap((event) => (event.postId ? [event.postId] : [])),
      ),
    ];
    if (seenIds.length) {
      await app.db
        .insert(seenPosts)
        .values(seenIds.map((postId) => ({ userId: req.authUser!.id, postId })))
        .onConflictDoNothing();
    }
    return { accepted: body.events.length };
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

export function diversifyGuestPosts<T extends { authorId: string }>(rows: T[], limit: number): T[] {
  const bounded = Math.max(0, Math.min(40, limit));
  const buckets = new Map<string, T[]>();
  for (const row of rows) buckets.set(row.authorId, [...(buckets.get(row.authorId) ?? []), row]);
  const result: T[] = [];
  while (result.length < bounded) {
    let added = false;
    for (const bucket of buckets.values()) {
      const next = bucket.shift();
      if (!next) continue;
      result.push(next);
      added = true;
      if (result.length === bounded) break;
    }
    if (!added) break;
  }
  return result;
}

async function blockedIds(app: FastifyInstance, userId: string) {
  const rows = await app.db.select().from(blocks).where(eq(blocks.blockerId, userId));
  const other = await app.db.select().from(blocks).where(eq(blocks.blockedId, userId));
  return [...rows.map((r) => r.blockedId), ...other.map((r) => r.blockerId)];
}

async function activeUserCount(app: FastifyInstance) {
  const [row] = await app.db.select({ count: sql<number>`count(*)::int` }).from(users);
  return row?.count ?? 0;
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

async function recentSearchTexts(app: FastifyInstance, viewer: string) {
  const rows = await app.db
    .select({ query: searchQueries.query })
    .from(searchQueries)
    .where(eq(searchQueries.userId, viewer))
    .orderBy(desc(searchQueries.createdAt))
    .limit(20);
  return rows.map((row) => row.query);
}

function tokenSimilarity(text: string, queries: string[]) {
  const words = new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  if (!words.size || !queries.length) return 0;
  let best = 0;
  for (const query of queries) {
    const tokens = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    if (tokens.length) best = Math.max(best, tokens.filter((token) => words.has(token)).length / tokens.length);
  }
  return best;
}

async function personalizationSignals(app: FastifyInstance, viewer: string, postIds: string[]) {
  const empty = {
    replyAuthors: new Set<string>(), authorEvents: new Map<string, number>(),
    reacted: new Set<string>(), commented: new Set<string>(), reposted: new Set<string>(),
    voiced: new Set<string>(), categories: new Map<string, number>(), seenCounts: new Map<string, number>(),
  };
  if (!postIds.length) return empty;
  const [events, ownComments, repostRows, voiceRows, listens] = await Promise.all([
    app.db.select({ postId: userEvents.postId, eventType: userEvents.eventType })
      .from(userEvents).where(and(eq(userEvents.userId, viewer), inArray(userEvents.postId, postIds)))
      .orderBy(desc(userEvents.createdAt)).limit(300),
    app.db.select({ postId: comments.postId, authorId: posts.authorId, category: comments.category, replyToUserId: comments.replyToUserId })
      .from(comments).innerJoin(posts, eq(posts.id, comments.postId))
      .where(eq(comments.authorId, viewer)).orderBy(desc(comments.createdAt)).limit(100),
    app.db.select({ postId: reposts.postId }).from(reposts)
      .where(and(eq(reposts.userId, viewer), inArray(reposts.postId, postIds))).limit(100),
    app.db.select({ postId: voices.postId }).from(voices)
      .where(and(eq(voices.userId, viewer), inArray(voices.postId, postIds))).limit(100),
    app.db.select({ authorId: posts.authorId }).from(listenEvents)
      .innerJoin(posts, eq(posts.id, listenEvents.postId))
      .where(eq(listenEvents.userId, viewer)).orderBy(desc(listenEvents.createdAt)).limit(100),
  ]);
  const categoryCounts = new Map<string, number>();
  for (const event of events) {
    if (!event.postId) continue;
    if (event.eventType === 'react') empty.reacted.add(event.postId);
    if (event.eventType === 'comment') empty.commented.add(event.postId);
    if (event.eventType === 'seen' || event.eventType === 'impression') {
      empty.seenCounts.set(event.postId, (empty.seenCounts.get(event.postId) ?? 0) + 1);
    }
  }
  for (const row of ownComments) {
    empty.commented.add(row.postId);
    empty.replyAuthors.add(row.replyToUserId ?? row.authorId);
    categoryCounts.set(row.category, (categoryCounts.get(row.category) ?? 0) + 1);
  }
  const categoryMax = Math.max(1, ...categoryCounts.values());
  for (const [category, count] of categoryCounts) empty.categories.set(category, count / categoryMax);
  for (const row of repostRows) empty.reposted.add(row.postId);
  for (const row of voiceRows) empty.voiced.add(row.postId);
  for (const row of listens) empty.authorEvents.set(row.authorId, (empty.authorEvents.get(row.authorId) ?? 0) + 1);
  return empty;
}

function deterministicExploreIds(candidates: RankCandidate[]) {
  const pool = candidates.filter((candidate) =>
    ['public', 'trending', 'lang_match', 'region_match', 'emotion_match'].includes(candidate.source));
  const count = Math.min(pool.length, Math.ceil(candidates.length * 0.18));
  const hash = (value: string) => [...value].reduce((sum, char) => ((sum * 33) ^ char.charCodeAt(0)) >>> 0, 5381);
  return new Set(pool.sort((a, b) => hash(a.post_id) - hash(b.post_id) || a.post_id.localeCompare(b.post_id))
    .slice(0, count).map((candidate) => candidate.post_id));
}

function injectExploration(ranked: string[], exploreIds: Set<string>) {
  const base = ranked.filter((id) => !exploreIds.has(id));
  const explore = ranked.filter((id) => exploreIds.has(id));
  for (let index = 0; index < explore.length; index += 1) {
    base.splice(Math.min(5 + index * 6, base.length), 0, explore[index]!);
  }
  return base;
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
