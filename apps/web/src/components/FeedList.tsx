'use client';

import { useEffect, useRef } from 'react';
import type { PostCard } from '@voiceout/shared';
import { FeedCard } from './FeedCard';
import { usePlayer } from '@/lib/player';

export function FeedList({
  posts,
  onChange,
  autoPlay,
}: {
  posts: PostCard[];
  onChange: (next: PostCard) => void;
  autoPlay?: boolean;
}) {
  const { play } = usePlayer();
  const playRef = useRef(play);
  playRef.current = play;
  const rootRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const ids = posts.map((p) => p.id).join(',');

  useEffect(() => {
    started.current = false;
  }, [ids]);

  useEffect(() => {
    posts.slice(0, 3).forEach((p) => {
      if (p.audioUrl) void fetch(p.audioUrl, { credentials: 'include' }).catch(() => undefined);
    });
  }, [ids, posts]);

  useEffect(() => {
    if (!autoPlay) return;
    const first = posts.find((p) => p.audioUrl);
    if (!first?.audioUrl || started.current) return;
    started.current = true;
    playRef.current({ id: first.id, src: first.audioUrl, durationMs: first.durationMs });
  }, [autoPlay, ids, posts]);

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
        if (!top?.dataset.id || !top.dataset.src) return;
        playRef.current({
          id: top.dataset.id,
          src: top.dataset.src,
          durationMs: Number(top.dataset.ms || 0),
        });
      },
      { root: null, rootMargin: '-18% 0px -62% 0px', threshold: 0.15 },
    );
    root.querySelectorAll('[data-feed-track]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [autoPlay, ids]);

  return (
    <div ref={rootRef}>
      {posts.map((p) => (
        <div key={p.id} data-feed-track data-id={p.id} data-src={p.audioUrl ?? ''} data-ms={p.durationMs}>
          <FeedCard post={p} onChange={onChange} />
        </div>
      ))}
    </div>
  );
}
