'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { useAuth } from './auth';
import { notificationReadPayload } from './safetyState';

const REFRESH_EVENT = 'voiceout:notifications-read';
type NotificationsContext = {
  unreadCount: number;
  refresh: () => Promise<void>;
  markRead: (ids?: string[]) => Promise<void>;
};

const Context = createContext<NotificationsContext | null>(null);

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!user) {
      setUnreadCount(0);
      return;
    }
    const data = await api<{ count: number }>('/notifications/unread-count');
    setUnreadCount(Math.max(0, data.count));
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
      return;
    }
    void refresh().catch(() => undefined);
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 45_000);
    const onFocus = () => void refresh().catch(() => undefined);
    window.addEventListener('focus', onFocus);
    window.addEventListener(REFRESH_EVENT, onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(REFRESH_EVENT, onFocus);
    };
  }, [refresh, user]);

  const value = useMemo(() => ({ unreadCount, refresh, markRead }), [unreadCount, refresh, markRead]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useNotifications() {
  const value = useContext(Context);
  if (!value) throw new Error('useNotifications');
  return value;
}
