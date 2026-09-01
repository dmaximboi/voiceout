'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { PostCard } from '@voiceout/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Composer } from '@/components/Composer';
import { FeedList } from '@/components/FeedList';
import { FeedSkeleton } from '@/components/FeedSkeleton';
import { SAMPLE_POSTS } from '@/lib/samplePosts';

type Tab = 'feed' | 'trending';

export default function HomePage() {
  const { user, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<Tab>('feed');
  const [feedPosts, setFeedPosts] = useState<PostCard[]>([]);
  const [trendPosts, setTrendPosts] = useState<PostCard[]>([]);
  const [loadingFeed, setLoadingFeed] = useState(true);
  const [loadingTrend, setLoadingTrend] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);

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
    setLoadingFeed(true);
    setLoadingTrend(true);
    setError(null);
    void api<{ posts: PostCard[] }>('/feed')
      .then((data) => {
        if (cancelled) return;
        setFeedPosts(data.posts);
        setLoadingFeed(false);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
        setFeedPosts([]);
        setLoadingFeed(false);
      });
    void api<{ posts: PostCard[] }>('/trending')
      .then((data) => {
        if (cancelled) return;
        setTrendPosts(data.posts);
        setLoadingTrend(false);
      })
      .catch(() => {
        if (cancelled) return;
        setTrendPosts([]);
        setLoadingTrend(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

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
      {error ? <p className="p-4 text-sm text-red-600">{error}</p> : null}
      {loading ? (
        <>
          <FeedSkeleton />
          <FeedSkeleton />
          <FeedSkeleton />
        </>
      ) : (
        <FeedList autoPlay posts={posts} onChange={patch} />
      )}
    </div>
  );
}
