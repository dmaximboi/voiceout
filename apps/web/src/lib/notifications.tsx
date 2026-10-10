'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { DropSignal } from '@voiceout/shared';
import { api } from './api';
import { useAuth } from './auth';
import { notificationReadPayload } from './safetyState';

const REFRESH_EVENT = 'voiceout:notifications-read';

export type DropSignals = Record<DropSignal, boolean>;

const emptySignals: DropSignals = {
  like: false,
  repost: false,
  comment: false,
  bookmark: false,
};

type NotificationsContext = {
  unreadCount: number;
  signals: DropSignals;
  refresh: () => Promise<void>;
  markRead: (ids?: string[]) => Promise<void>;
};

const Context = createContext<NotificationsContext | null>(null);

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [signals, setSignals] = useState<DropSignals>(emptySignals);

  const refresh = useCallback(async () => {
    if (!user) {
      setUnreadCount(0);
      setSignals(emptySignals);
      return;
    }
    const data = await api<{ count: number; signals?: Partial<DropSignals> }>('/notifications/unread-count');
    setUnreadCount(Math.max(0, data.count));
    setSignals({
      like: Boolean(data.signals?.like),
      repost: Boolean(data.signals?.repost),
      comment: Boolean(data.signals?.comment),
      bookmark: Boolean(data.signals?.bookmark),
    });
  }, [user]);

  const markRead = useCallback(async (ids?: string[]) => {
    await api('/notifications/read', {
      method: 'POST',
      body: JSON.stringify(notificationReadPayload(ids)),
    });
    window.dispatchEvent(new Event(REFRESH_EVENT));
  }, []);

  useEffect(() => {
    if (!user) {
      setUnreadCount(0);
      setSignals(emptySignals);
      return;
    }
    void refresh().catch(() => undefined);
    const focusGapMs = 3 * 60 * 1000;
    let lastFocusRefresh = Date.now();
    const onExplicit = () => void refresh().catch(() => undefined);
    const onFocusRefresh = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastFocusRefresh < focusGapMs) return;
      lastFocusRefresh = now;
      void refresh().catch(() => undefined);
    };
    window.addEventListener('focus', onFocusRefresh);
    document.addEventListener('visibilitychange', onFocusRefresh);
    window.addEventListener(REFRESH_EVENT, onExplicit);
    return () => {
      window.removeEventListener('focus', onFocusRefresh);
      document.removeEventListener('visibilitychange', onFocusRefresh);
      window.removeEventListener(REFRESH_EVENT, onExplicit);
    };
  }, [refresh, user]);

  const value = useMemo(
    () => ({ unreadCount, signals, refresh, markRead }),
    [unreadCount, signals, refresh, markRead],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useNotifications() {
  const value = useContext(Context);
  if (!value) throw new Error('useNotifications');
  return value;
}
