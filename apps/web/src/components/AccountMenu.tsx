'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { Avatar } from './Avatar';

export function AccountMenu() {
  const { user, loading } = useAuth();

  if (loading) {
    return <span className="h-8 w-8 shrink-0 rounded-full bg-[var(--card)]" />;
  }

  if (!user) {
    return (
      <Link href="/login" aria-label="Log in" className="block h-8 w-8 shrink-0 overflow-hidden rounded-full active:opacity-80">
        <Avatar name="" src={null} size="xs" />
      </Link>
    );
  }

  return (
    <Link href="/me" aria-label="Your posts" className="block h-8 w-8 shrink-0 overflow-hidden rounded-full active:opacity-80">
      <Avatar name={user.displayName} src={user.avatarUrl} size="xs" />
    </Link>
  );
}
