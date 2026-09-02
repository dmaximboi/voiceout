'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { PostCard, PublicUser } from '@voiceout/shared';
import { api } from '@/lib/api';
import { Avatar } from '@/components/Avatar';

export function PeopleSearch({ query }: { query: string }) {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [posts, setPosts] = useState<PostCard[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (query.trim().length < 1) {
      setUsers([]);
      setPosts([]);
      setBusy(false);
      return;
    }
    const t = window.setTimeout(() => {
      setBusy(true);
      void Promise.all([
        api<{ users: PublicUser[] }>(`/search/users?q=${encodeURIComponent(query)}`)
          .then((d) => setUsers(d.users))
          .catch(() => setUsers([])),
        api<{ posts: PostCard[] }>(`/search/posts?q=${encodeURIComponent(query)}`)
          .then((d) => setPosts(d.posts))
          .catch(() => setPosts([])),
      ]).finally(() => setBusy(false));
    }, 140);
    return () => window.clearTimeout(t);
  }, [query]);

  if (!query.trim()) {
    return <p className="px-4 py-6 text-sm text-[var(--muted)]">Find people or captions.</p>;
  }
  if (busy && users.length === 0 && posts.length === 0) {
    return <p className="px-4 py-6 text-sm text-[var(--muted)]">Searching.</p>;
  }
  if (users.length === 0 && posts.length === 0) {
    return <p className="px-4 py-6 text-sm text-[var(--muted)]">Nothing matched that.</p>;
  }

  return (
    <div>
      {users.length > 0 ? (
        <ul>
          {users.map((u) => (
            <li key={u.id} className="border-b border-[var(--line)]">
              <Link
                href={`/u/${u.handle}`}
                className="flex min-h-14 items-center gap-3 px-4 py-3 active:bg-[var(--bg)]"
              >
                <Avatar name={u.displayName} src={u.avatarUrl} />
                <div>
                  <div className="font-semibold">{u.displayName}</div>
                  <div className="text-sm text-[var(--muted)]">@{u.handle}</div>
                  {u.bio ? <div className="text-sm">{u.bio}</div> : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {posts.length > 0 ? (
        <div className="border-t border-[var(--line)]">
          <p className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Captions
          </p>
          <ul>
            {posts.map((p) => (
              <li key={p.id} className="border-b border-[var(--line)]">
                <Link href={`/post/${p.id}`} className="block px-4 py-3 active:bg-[var(--bg)]">
                  <div className="text-sm font-semibold">
                    {p.author.displayName}{' '}
                    <span className="font-normal text-[var(--muted)]">@{p.author.handle}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm">{p.caption}</p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
