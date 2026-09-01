'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { PublicUser } from '@voiceout/shared';
import { api } from '@/lib/api';
import { Avatar } from '@/components/Avatar';

export function PeopleSearch({ query }: { query: string }) {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (query.trim().length < 1) {
      setUsers([]);
      setBusy(false);
      return;
    }
    const t = window.setTimeout(() => {
      setBusy(true);
      void api<{ users: PublicUser[] }>(`/search/users?q=${encodeURIComponent(query)}`)
        .then((d) => setUsers(d.users))
        .catch(() => setUsers([]))
        .finally(() => setBusy(false));
    }, 140);
    return () => window.clearTimeout(t);
  }, [query]);

  if (!query.trim()) {
    return <p className="px-4 py-6 text-sm text-[var(--muted)]">Find people by name or handle.</p>;
  }
  if (busy && users.length === 0) {
    return <p className="px-4 py-6 text-sm text-[var(--muted)]">Searching.</p>;
  }
  if (users.length === 0) {
    return <p className="px-4 py-6 text-sm text-[var(--muted)]">No one matched that.</p>;
  }

  return (
    <ul>
      {users.map((u) => (
        <li key={u.id} className="border-b border-[var(--line)]">
          <Link href={`/u/${u.handle}`} className="flex min-h-14 items-center gap-3 px-4 py-3 active:bg-[var(--bg)]">
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
  );
}
