'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { ContentShelf, FeedFeedbackKind, PostCard } from '@voiceout/shared';
import { CONTENT_SHELVES, CONTENT_SHELF_LABELS } from '@voiceout/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Composer } from '@/components/Composer';
import { FeedList } from '@/components/FeedList';
import { FeedSkeleton } from '@/components/FeedSkeleton';
import { SAMPLE_POSTS } from '@/lib/samplePosts';
import { restoreRemovedPosts } from '@/lib/safetyState';
import { GuestHome } from '@/components/GuestHome';

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
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('feed');
  const [shelf, setShelf] = useState<ContentShelf | null>(null);
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
    if (authLoading || !user) return;
    if (user.followingCount > 0) return;
    let seen = false;
    let needed = false;
    try {
      seen = Boolean(sessionStorage.getItem('vo_welcome_seen'));
      needed = sessionStorage.getItem('vo_need_welcome') === '1';
    } catch {
      /* private mode */
    }
    try {
      seen = seen || Boolean(localStorage.getItem('vo_welcome_seen'));
    } catch {
      /* private mode */
    }
    if (seen) return;
    const age = Date.now() - Date.parse(user.createdAt);
    if (!needed && age > 15 * 60 * 1000) return;
    router.replace('/welcome');
  }, [user, authLoading, router]);

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
    const shelfQuery = shelf ? `&shelf=${shelf}` : '';
    setFeedPosts([]);

    async function loadFeed(initial: boolean) {
      if (initial && !seeded.feed) {
        setLoadingFeed(true);
        setError(null);
      }
      try {
        if (initial && !seeded.feed) {
          const fast = await api<{ posts: PostCard[] }>(`/feed?fast=1${shelfQuery}`);
          if (cancelled) return;
          if (fast.posts.length > 0) setFeedPosts(fast.posts.filter((post) => !post.id.startsWith('sample-')));
          seeded.feed = true;
          setLoadingFeed(false);
        }
        const feed = await api<{ posts: PostCard[] }>(`/feed${shelf ? `?shelf=${shelf}` : ''}`);
        if (cancelled) return;
        setFeedPosts((prev) => {
          const incoming = feed.posts.filter((post) => !post.id.startsWith('sample-'));
          if (incoming.length === 0) return prev.filter((post) => !post.id.startsWith('sample-'));
          const live = prev.filter((post) => !post.id.startsWith('sample-'));
          if (live.length === 0) return incoming;
          return mergePosts(incoming, live);
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
    const focusGapMs = 3 * 60 * 1000;
    let lastFocusRefresh = Date.now();
    function onRefresh() {
      void loadFeed(false);
      void loadTrend(false);
    }
    function onFocusRefresh() {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastFocusRefresh < focusGapMs) return;
      lastFocusRefresh = now;
      onRefresh();
    }
    window.addEventListener('vo:refresh-feed', onRefresh);
    window.addEventListener('focus', onFocusRefresh);
    document.addEventListener('visibilitychange', onFocusRefresh);
    function onSwMessage(event: MessageEvent) {
      if (event.data?.type === 'FEED_PULL') onRefresh();
    }
    navigator.serviceWorker?.addEventListener('message', onSwMessage);
    return () => {
      cancelled = true;
      window.removeEventListener('vo:refresh-feed', onRefresh);
      window.removeEventListener('focus', onFocusRefresh);
      document.removeEventListener('visibilitychange', onFocusRefresh);
      navigator.serviceWorker?.removeEventListener('message', onSwMessage);
    };
  }, [user?.id, authLoading, shelf]);

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

  if (!authLoading && !user) {
    return <GuestHome />;
  }

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
      {tab === 'feed' ? (
        <div className="flex gap-2 overflow-x-auto border-b border-[var(--line)] px-3 py-2">
          <button
            type="button"
            className={`min-h-9 shrink-0 rounded-full px-3 text-sm font-semibold ${shelf === null ? 'bg-accent text-white' : 'text-[var(--muted)]'}`}
            onClick={() => setShelf(null)}
          >
            All
          </button>
          {CONTENT_SHELVES.map((item) => (
            <button
              key={item}
              type="button"
              className={`min-h-9 shrink-0 rounded-full px-3 text-sm font-semibold ${shelf === item ? 'bg-accent text-white' : 'text-[var(--muted)]'}`}
              onClick={() => setShelf(item)}
            >
              {CONTENT_SHELF_LABELS[item]}
            </button>
          ))}
        </div>
      ) : null}
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
        <FeedList
          autoPlay
          posts={posts}
          onChange={patch}
          onFeedback={giveFeedback}
          onRemove={(id) => {
            setFeedPosts((all) => all.filter((p) => p.id !== id));
            setTrendPosts((all) => all.filter((p) => p.id !== id));
          }}
        />
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
