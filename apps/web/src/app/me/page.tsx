'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import type { FeedItem, PostCard } from '@voiceout/shared';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';
import { Avatar } from '@/components/AppShell';
import { FeedCard } from '@/components/FeedCard';

type Tab = 'posts' | 'bookmarks' | 'voiced';

export default function MePage() {
  const { user, loading } = useRequireAuth();
  const [tab, setTab] = useState<Tab>('posts');
  const [posts, setPosts] = useState<PostCard[]>([]);
  const [bookmarks, setBookmarks] = useState<PostCard[]>([]);
  const [bookmarkKey, setBookmarkKey] = useState<string | null>(null);
  const [bookmarkMore, setBookmarkMore] = useState(false);
  const [voiced, setVoiced] = useState<FeedItem[]>([]);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setBusy(true);
    const load =
      tab === 'posts'
        ? api<{ posts: PostCard[] }>(`/users/${user.handle}/posts`).then((d) => {
            if (!cancelled) setPosts(d.posts);
          })
        : tab === 'bookmarks'
          ? api<{ posts: PostCard[]; lastKey: string | null }>('/users/me/bookmarks').then((d) => {
              if (!cancelled) {
                setBookmarks(d.posts);
                setBookmarkKey(d.lastKey);
              }
            })
          : api<{ items: FeedItem[] }>('/users/me/voiced').then((d) => {
              if (!cancelled) setVoiced(d.items);
            });
    void load.catch(() => undefined).finally(() => {
      if (!cancelled) setBusy(false);
    });
    return () => {
      cancelled = true;
    };
  }, [user, tab]);

  async function loadMoreBookmarks() {
    if (!bookmarkKey || bookmarkMore) return;
    setBookmarkMore(true);
    try {
      const d = await api<{ posts: PostCard[]; lastKey: string | null }>(
        `/users/me/bookmarks?lastKey=${encodeURIComponent(bookmarkKey)}`,
      );
      setBookmarks((cur) => {
        const seen = new Set(cur.map((p) => p.id));
        return [...cur, ...d.posts.filter((p) => !seen.has(p.id))];
      });
      setBookmarkKey(d.lastKey);
    } catch {
      /* keep current page */
    } finally {
      setBookmarkMore(false);
    }
  }

  if (loading || !user) {
    return <p className="p-6 text-sm text-[var(--muted)]">Checking your session.</p>;
  }

  const list = tab === 'posts' ? posts : tab === 'bookmarks' ? bookmarks : voiced;

  return (
    <div>
      <div className="border-b border-[var(--line)] px-4 py-6">
        <Avatar name={user.displayName} src={user.avatarUrl} size="lg" />
        <h1 className="mt-3 text-xl font-bold">{user.displayName}</h1>
        <p className="text-[var(--muted)]">@{user.handle}</p>
        {user.bio ? <p className="mt-2 text-sm">{user.bio}</p> : null}
        <p className="mt-3 text-sm">
          <span className="font-semibold">{user.followingCount}</span> Following ·{' '}
          <span className="font-semibold">{user.followerCount}</span> Followers
        </p>
        <Link
          href="/settings"
          className="mt-4 inline-flex min-h-11 items-center rounded-full border border-[var(--line)] px-4 text-sm active:bg-[var(--bg)]"
        >
          Edit profile
        </Link>
      </div>
      <div className="sticky top-[var(--header-h)] z-10 flex border-b border-[var(--line)] bg-[var(--card)]">
        {(
          [
            ['posts', 'Posts'],
            ['bookmarks', 'Bookmarks'],
            ['voiced', 'Voiced'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex min-h-12 flex-1 items-center justify-center text-sm font-semibold active:opacity-80 ${
              tab === id ? 'border-b-2 border-accent text-accent' : 'text-[var(--muted)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {busy ? (
        <p className="p-6 text-sm text-[var(--muted)]">Loading.</p>
      ) : list.length === 0 ? (
        <p className="p-6 text-sm text-[var(--muted)]">
          {tab === 'posts'
            ? 'You have not posted yet.'
            : tab === 'bookmarks'
              ? 'No bookmarks yet.'
              : 'No reposts or voices yet.'}
        </p>
      ) : tab === 'voiced' ? (
        voiced.map((item) => (
          <div key={item.id}>
            <p className="px-4 pt-3 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
              {item.type === 'voice' ? 'You voiced' : 'You reposted'}
            </p>
            {item.body ? <p className="px-4 pt-1 text-[15px] leading-6">{item.body}</p> : null}
            <FeedCard
              post={item.post}
              onChange={(next) =>
                setVoiced((all) => all.map((x) => (x.post.id === next.id ? { ...x, post: next } : x)))
              }
            />
          </div>
        ))
      ) : (
        (tab === 'posts' ? posts : bookmarks).map((p) => (
          <FeedCard
            key={p.id}
            post={p}
            onChange={(next) => {
              const patch = (all: PostCard[]) => all.map((x) => (x.id === next.id ? next : x));
              if (tab === 'posts') setPosts(patch);
              else setBookmarks(patch);
            }}
          />
        ))
      )}
      {tab === 'bookmarks' && bookmarkKey ? (
        <div className="p-4">
          <button
            type="button"
            className="flex min-h-11 w-full items-center justify-center rounded-full border border-[var(--line)] text-sm font-semibold active:bg-[var(--bg)]"
            onClick={() => void loadMoreBookmarks()}
            disabled={bookmarkMore}
          >
            {bookmarkMore ? 'Loading' : 'Load more'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
