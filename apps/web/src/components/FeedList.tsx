'use client';

import { useEffect, useRef } from 'react';
import type { FeedEvent, FeedFeedbackKind, PostCard } from '@voiceout/shared';
import { FeedCard } from './FeedCard';
import { usePlayer } from '@/lib/player';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export function FeedList({
  posts,
  onChange,
  onFeedback,
  autoPlay,
}: {
  posts: PostCard[];
  onChange: (next: PostCard) => void;
  onFeedback?: (post: PostCard, kind: FeedFeedbackKind) => void;
  autoPlay?: boolean;
}) {
  const { user } = useAuth();
  const { play, pause, track } = usePlayer();
  const playRef = useRef(play);
  const pauseRef = useRef(pause);
  playRef.current = play;
  pauseRef.current = pause;
  const rootRef = useRef<HTMLDivElement>(null);
  const impressed = useRef(new Set<string>());
  const seen = useRef(new Set<string>());
  const activeId = useRef<string | null>(null);
  const ids = posts.map((p) => p.id).join(',');

  useEffect(() => {
    // Warm the first ~15s of the top posts so playback starts instantly.
    // ~60KB ≈ 15s at ~32kbps Opus; fall back to full fetch if Range is ignored.
    const warm = posts.slice(0, 18).filter((p) => p.audioUrl);
    warm.forEach((p, i) => {
      window.setTimeout(() => {
        void fetch(p.audioUrl!, {
          credentials: 'include',
          headers: { Range: 'bytes=0-65535' },
        }).catch(() => undefined);
      }, i * 40);
    });
  }, [ids, posts]);

  // Pause when leaving the feed so audio cannot keep playing against a blank UI.
  useEffect(() => {
    return () => {
      pauseRef.current();
      activeId.current = null;
    };
  }, []);

  useEffect(() => {
    if (!autoPlay) return;
    const root = rootRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting && (e.target as HTMLElement).dataset.src)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const top = visible[0]?.target as HTMLElement | undefined;
        if (!top?.dataset.id || !top.dataset.src) {
          if (activeId.current) {
            pauseRef.current();
            activeId.current = null;
          }
          return;
        }
        if (activeId.current === top.dataset.id) return;
        activeId.current = top.dataset.id;
        playRef.current({
          id: top.dataset.id,
          src: top.dataset.src,
          durationMs: Number(top.dataset.ms || 0),
        });
      },
      { root: null, rootMargin: '-20% 0px -55% 0px', threshold: [0.2, 0.4] },
    );
    root.querySelectorAll('[data-feed-track]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [autoPlay, ids]);

  // If the playing track left the list (refresh/filter), stop it.
  useEffect(() => {
    if (!track) return;
    if (!posts.some((p) => p.id === track.id)) {
      pause();
      activeId.current = null;
    }
  }, [ids, posts, track, pause]);

  useEffect(() => {
    if (!user) return;
    const root = rootRef.current;
    if (!root) return;
    const pending: FeedEvent[] = [];
    const visible = new Set<string>();
    const seenTimers = new Map<string, number>();
    let flushTimer: number | undefined;

    function flush() {
      if (flushTimer) window.clearTimeout(flushTimer);
      flushTimer = undefined;
      if (pending.length === 0) return;
      const events = pending.splice(0, 50);
      void api('/feed/events', {
        method: 'POST',
        body: JSON.stringify({ events }),
      }).catch(() => undefined);
      if (pending.length > 0) flushTimer = window.setTimeout(flush, 1000);
    }

    function queue(event: FeedEvent) {
      pending.push(event);
      if (pending.length >= 20) flush();
      else if (!flushTimer) flushTimer = window.setTimeout(flush, 1800);
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const postId = (entry.target as HTMLElement).dataset.id;
          if (!postId) continue;
          const qualifies = entry.isIntersecting && entry.intersectionRatio >= 0.25;
          if (!qualifies) {
            visible.delete(postId);
            const timer = seenTimers.get(postId);
            if (timer) window.clearTimeout(timer);
            seenTimers.delete(postId);
            continue;
          }
          visible.add(postId);
          if (!impressed.current.has(postId) && impressed.current.size < 500) {
            impressed.current.add(postId);
            queue({ eventType: 'impression', postId, source: 'home_feed' });
          }
          if (!seen.current.has(postId) && !seenTimers.has(postId) && seen.current.size < 500) {
            seenTimers.set(
              postId,
              window.setTimeout(() => {
                seenTimers.delete(postId);
                if (!visible.has(postId) || seen.current.has(postId)) return;
                seen.current.add(postId);
                queue({ eventType: 'seen', postId, source: 'home_feed', dwellMs: 1200 });
              }, 1200),
            );
          }
        }
      },
      { threshold: [0, 0.25, 0.6] },
    );
    root.querySelectorAll('[data-feed-track]').forEach((el) => io.observe(el));
    return () => {
      io.disconnect();
      seenTimers.forEach((timer) => window.clearTimeout(timer));
      flush();
    };
  }, [ids, user]);

  return (
    <div ref={rootRef}>
      {posts.map((p) => (
        <div
          key={p.id}
          data-feed-track
          data-id={p.id}
          data-src={p.audioUrl ?? ''}
          data-ms={p.durationMs}
        >
          <FeedCard post={p} onChange={onChange} onFeedback={onFeedback} />
        </div>
      ))}
    </div>
  );
}
