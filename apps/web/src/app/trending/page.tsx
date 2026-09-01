'use client';

import { useEffect, useState } from 'react';
import type { PostCard } from '@voiceout/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { FeedList } from '@/components/FeedList';
import { SAMPLE_POSTS } from '@/lib/samplePosts';

export default function TrendingPage() {
  const { user, loading } = useAuth();
  const [posts, setPosts] = useState<PostCard[]>([]);
  useEffect(() => {
    if (loading) return;
    if (!user) {
      setPosts(SAMPLE_POSTS);
      return;
    }
    void api<{ posts: PostCard[] }>('/trending').then((d) => setPosts(d.posts)).catch(() => setPosts([]));
  }, [user, loading]);
  return (
    <div>
      <h1 className="border-b border-[var(--line)] px-4 py-3 text-lg font-bold">Trending</h1>
      <FeedList
        autoPlay
        posts={posts}
        onChange={(next) => setPosts((all) => all.map((x) => (x.id === next.id ? next : x)))}
      />
    </div>
  );
}
