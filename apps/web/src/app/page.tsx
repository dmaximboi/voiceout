'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { FeedFeedbackKind, PostCard } from '@voiceout/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Composer } from '@/components/Composer';
import { FeedList } from '@/components/FeedList';
import { FeedSkeleton } from '@/components/FeedSkeleton';
import { SAMPLE_POSTS } from '@/lib/samplePosts';
import { restoreRemovedPosts } from '@/lib/safetyState';

type Tab = 'feed' | 'trending';
type RemovedPost = { post: PostCard; index: number };
type UndoFeedback = {
  id: number;
  postId: string;
  kind: FeedFeedbackKind;
  feed: RemovedPost[];
  trending: RemovedPost[];
  message: string;
};

export default function HomePage() {
  const { user, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<Tab>('feed');
  const [feedPosts, setFeedPosts] = useState<PostCard[]>([]);
  const [trendPosts, setTrendPosts] = useState<PostCard[]>([]);
  const [loadingFeed, setLoadingFeed] = useState(true);
  const [loadingTrend, setLoadingTrend] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [undoFeedback, setUndoFeedback] = useState<UndoFeedback | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const feedbackId = useRef(0);
  const feedbackRequests = useRef(new Map<number, Promise<void>>());

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('vo_notice');
      if (saved) {
        sessionStorage.removeItem('vo_notice');
        setNotice(saved);
      }
    } catch {
      /* private mode */
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setFeedPosts(SAMPLE_POSTS);
      setTrendPosts(SAMPLE_POSTS);
      setError(null);
      setLoadingFeed(false);
      setLoadingTrend(false);
      return;
    }
    let cancelled = false;
    const seeded = { feed: false, trend: false };

    async function loadFeed(initial: boolean) {
      if (initial && !seeded.feed) {
        setLoadingFeed(true);
        setError(null);
      }
      try {
        if (initial && !seeded.feed) {
          const fast = await api<{ posts: PostCard[] }>('/feed?fast=1');
          if (cancelled) return;
          if (fast.posts.length > 0) setFeedPosts(fast.posts);
          seeded.feed = true;
          setLoadingFeed(false);
        }
        const feed = await api<{ posts: PostCard[] }>('/feed');
        if (cancelled) return;
        setFeedPosts((prev) => {
          if (feed.posts.length === 0) return prev;
          if (initial) return feed.posts;
          return mergePosts(feed.posts, prev);
        });
        seeded.feed = true;
        setLoadingFeed(false);
      } catch (e) {
        if (cancelled) return;
        if (initial && !seeded.feed) {
          setError(e instanceof Error ? e.message : 'Could not load feed');
          setLoadingFeed(false);
        }
      }
    }

    async function loadTrend(initial: boolean) {
      if (initial && !seeded.trend) setLoadingTrend(true);
      try {
        const trend = await api<{ posts: PostCard[] }>('/trending');
        if (cancelled) return;
        setTrendPosts((prev) => {
          if (trend.posts.length === 0) return prev;
          if (initial) return trend.posts;
          return mergePosts(trend.posts, prev);
        });
        seeded.trend = true;
        setLoadingTrend(false);
      } catch {
        if (cancelled) return;
        if (initial && !seeded.trend) {
          setLoadingTrend(false);
        }
      }
    }

    void loadFeed(true);
    void loadTrend(true);
    const poll = window.setInterval(() => {
      void loadFeed(false);
      void loadTrend(false);
    }, 20_000);
    function onRefresh() {
      void loadFeed(false);
      void loadTrend(false);
    }
    window.addEventListener('vo:refresh-feed', onRefresh);
    function onSwMessage(event: MessageEvent) {
      if (event.data?.type === 'FEED_PULL') {
        void loadFeed(false);
        void loadTrend(false);
      }
    }
    navigator.serviceWorker?.addEventListener('message', onSwMessage);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.removeEventListener('vo:refresh-feed', onRefresh);
      navigator.serviceWorker?.removeEventListener('message', onSwMessage);
    };
  }, [user?.id, authLoading]);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('button,a,input,textarea,[data-feed-track]')) {
      swipe.current = { x: e.clientX, y: e.clientY };
      return;
    }
    swipe.current = { x: e.clientX, y: e.clientY };
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0) setTab('trending');
    else setTab('feed');
  }

  const posts = tab === 'feed' ? feedPosts : trendPosts;
  const loading = tab === 'feed' ? loadingFeed : loadingTrend;

  function patch(next: PostCard) {
    const apply = (all: PostCard[]) => all.map((x) => (x.id === next.id ? next : x));
    setFeedPosts(apply);
    setTrendPosts(apply);
  }

  function giveFeedback(post: PostCard, kind: FeedFeedbackKind) {
    const id = ++feedbackId.current;
    const predicate =
      kind === 'hide_author'
        ? (candidate: PostCard) => candidate.author.id === post.author.id
        : (candidate: PostCard) => candidate.id === post.id;
    const feed = removedPosts(feedPosts, predicate);
    const trending = removedPosts(trendPosts, predicate);
    setFeedPosts((all) => all.filter((candidate) => !predicate(candidate)));
    setTrendPosts((all) => all.filter((candidate) => !predicate(candidate)));
    setUndoFeedback({
      id,
      postId: post.id,
      kind,
      feed,
      trending,
      message:
        kind === 'hide_author' ? `Posts from ${post.author.displayName} hidden.` : 'Post hidden.',
    });
    const request = api('/feed/feedback', {
      method: 'POST',
      body: JSON.stringify({ postId: post.id, kind }),
    })
      .then(() => undefined)
      .catch(() => {
        setFeedPosts((all) => restoreRemovedPosts(all, feed));
        setTrendPosts((all) => restoreRemovedPosts(all, trending));
        setUndoFeedback((current) =>
          current?.id === id
            ? { ...current, feed: [], trending: [], message: 'Could not update your feed.' }
            : current,
        );
      })
      .finally(() => {
        feedbackRequests.current.delete(id);
      });
    feedbackRequests.current.set(id, request);
  }

  async function undo() {
    const action = undoFeedback;
    if (!action || action.feed.length + action.trending.length === 0) {
      setUndoFeedback(null);
      return;
    }
    await feedbackRequests.current.get(action.id);
    try {
      await api('/feed/feedback', {
        method: 'DELETE',
        body: JSON.stringify({ postId: action.postId, kind: action.kind }),
      });
      setFeedPosts((all) => restoreRemovedPosts(all, action.feed));
      setTrendPosts((all) => restoreRemovedPosts(all, action.trending));
      setUndoFeedback(null);
    } catch {
      setUndoFeedback((current) =>
        current?.id === action.id
          ? { ...current, message: 'Could not undo that feed change.' }
          : current,
      );
    }
  }

  return (
    <div onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
      <div className="sticky top-[var(--header-h)] z-10 flex border-b border-[var(--line)] bg-[var(--card)]">
        <button
          type="button"
          className={`flex min-h-12 flex-1 items-center justify-center text-sm font-semibold active:opacity-80 ${tab === 'feed' ? 'border-b-2 border-accent text-accent' : 'text-[var(--muted)]'}`}
          onClick={() => setTab('feed')}
        >
          For you
        </button>
        <button
          type="button"
          className={`flex min-h-12 flex-1 items-center justify-center text-sm font-semibold active:opacity-80 ${tab === 'trending' ? 'border-b-2 border-accent text-accent' : 'text-[var(--muted)]'}`}
          onClick={() => setTab('trending')}
        >
          Trending
        </button>
      </div>
      <Composer />
      {notice ? <p className="px-4 pt-3 text-sm text-accent">{notice}</p> : null}
      {error ? <p className="p-4 text-sm text-red-600">{error}</p> : null}
      {loading && posts.length === 0 ? (
        <>
          <FeedSkeleton />
          <FeedSkeleton />
          <FeedSkeleton />
        </>
      ) : (
        <FeedList autoPlay posts={posts} onChange={patch} onFeedback={giveFeedback} />
      )}
      {undoFeedback ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-24 left-1/2 z-50 flex w-[min(92vw,28rem)] -translate-x-1/2 items-center gap-3 rounded-2xl bg-[var(--text)] px-4 py-3 text-sm text-[var(--card)] shadow-xl lg:bottom-6"
        >
          <span className="min-w-0 flex-1">{undoFeedback.message}</span>
          {undoFeedback.feed.length + undoFeedback.trending.length > 0 ? (
            <button
              type="button"
              className="min-h-9 shrink-0 font-bold text-accent"
              onClick={() => void undo()}
            >
              Undo
            </button>
          ) : (
            <button
              type="button"
              className="min-h-9 shrink-0 font-bold"
              onClick={() => setUndoFeedback(null)}
            >
              Dismiss
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function removedPosts(posts: PostCard[], predicate: (post: PostCard) => boolean): RemovedPost[] {
  return posts.flatMap((post, index) => (predicate(post) ? [{ post, index }] : []));
}

function mergePosts(incoming: PostCard[], previous: PostCard[]) {
  const seen = new Set(previous.map((p) => p.id));
  const fresh = incoming.filter((p) => !seen.has(p.id));
  if (fresh.length === 0) {
    const byId = new Map(incoming.map((p) => [p.id, p]));
    return previous.map((p) => byId.get(p.id) ?? p);
  }
  return [...fresh, ...previous];
}
