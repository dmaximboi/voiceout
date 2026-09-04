'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { NotificationCard } from '@voiceout/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Avatar } from '@/components/Avatar';
import { SendBar } from './SendProgress';
import { useNotifications } from '@/lib/notifications';

export function DropsList({ onViewed }: { onViewed?: (ids: string[]) => void }) {
  const { user, loading } = useAuth();
  const { markRead, refresh } = useNotifications();
  const [items, setItems] = useState<NotificationCard[] | null>(null);
  const [clearBusy, setClearBusy] = useState(false);

  useEffect(() => {
    if (!user) {
      setItems([]);
      return;
    }
    let cancelled = false;
    void api<{ notifications: NotificationCard[] }>('/notifications')
      .then((d) => {
        if (cancelled) return;
        setItems(d.notifications);
        const unreadIds = d.notifications.filter((item) => !item.readAt && !item.id.startsWith('trend-')).map((item) => item.id);
        if (unreadIds.length) {
          onViewed?.(unreadIds);
          void markRead(unreadIds).catch(() => undefined);
        }
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user, markRead, onViewed]);

  async function clearAll() {
    if (!items?.length || clearBusy) return;
    if (!window.confirm('Clear all drops?')) return;
    setClearBusy(true);
    try {
      await api('/notifications', { method: 'DELETE' });
      setItems([]);
      await refresh();
    } catch {
      // keep list; user can retry
    } finally {
      setClearBusy(false);
    }
  }

  if (loading || items === null) {
    return <p className="px-4 py-6 text-sm text-[var(--muted)]">Checking drops.</p>;
  }

  if (!user) {
    return (
      <div className="px-4 py-6">
        <p className="text-sm text-[var(--muted)]">Quiet for now. Log in to catch your drops.</p>
        <Link href="/login" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-accent">
          Log in
        </Link>
      </div>
    );
  }

  if (items.length === 0) {
    return <p className="px-4 py-6 text-sm text-[var(--muted)]">All quiet. No drops yet.</p>;
  }

  return (
    <div>
      <SendBar />
      <div className="flex justify-end px-4 pt-2">
        <button
          type="button"
          disabled={clearBusy}
          onClick={() => void clearAll()}
          className="min-h-10 rounded-full px-3 text-sm font-semibold text-[var(--muted)] active:bg-[var(--bg)] disabled:opacity-50"
        >
          {clearBusy ? 'Clearing…' : 'Clear all'}
        </button>
      </div>
      <ul>
        {items.map((n) => (
          <li key={n.id} className="flex gap-3 border-b border-[var(--line)] px-4 py-3">
            <Avatar name={n.actor.displayName} src={n.actor.avatarUrl} />
            <div className="text-sm">
              <Link href={`/u/${n.actor.handle}`} className="font-semibold">
                @{n.actor.handle}
              </Link>{' '}
              {label(n.type)}
              {n.postId ? (
                <Link href={`/post/${n.postId}`} className="ml-1 text-accent">
                  View
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function label(type: NotificationCard['type']) {
  if (type === 'follow') return 'followed you';
  if (type === 'comment') return 'commented on your voice';
  if (type === 'reaction') return 'liked your voice';
  if (type === 'repost') return 'reshared your voice';
  if (type === 'bookmark') return 'bookmarked your voice';
  if (type === 'follow_post') return 'dropped a new voice';
  if (type === 'trending') return 'is trending';
  if (type === 'account_warning') return 'sent an account notice';
  return 'liked your comment';
}
