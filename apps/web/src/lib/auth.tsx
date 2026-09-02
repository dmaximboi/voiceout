'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { MeUser } from '@voiceout/shared';
import { api, ApiError, clearCsrf } from './api';

type AuthCtx = {
  user: MeUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  applyUser: (user: MeUser | null) => void;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<MeUser | null>(null);
  const [loading, setLoading] = useState(true);
  const epoch = useRef(0);
  const userRef = useRef<MeUser | null>(null);
  userRef.current = user;

  async function refresh() {
    const mine = ++epoch.current;
    try {
      let data: { user: MeUser };
      try {
        data = await api<{ user: MeUser }>('/auth/me');
      } catch (err) {
        // One soft retry on transient API/proxy failures.
        if (!(err instanceof ApiError) || (err.status < 500 && err.status !== 429)) throw err;
        await new Promise((r) => setTimeout(r, 400));
        data = await api<{ user: MeUser }>('/auth/me');
      }
      if (mine !== epoch.current) return;
      setUser({ ...data.user, hasPassword: Boolean(data.user.hasPassword) });
    } catch (err) {
      if (mine !== epoch.current) return;
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
        return;
      }
      // Keep the current session on rate-limit / proxy blips — never crash the tree.
      console.error(err);
      if (!userRef.current) setUser(null);
    } finally {
      if (mine === epoch.current) setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!user) return;
    const idleMs = 30 * 60 * 1000;
    let timer: ReturnType<typeof setTimeout>;
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void (async () => {
          try {
            await api('/auth/logout', { method: 'POST', body: '{}' });
          } catch (err) {
            console.error(err);
          } finally {
            clearCsrf();
            setUser(null);
          }
        })();
      }, idleMs);
    };
    bump();
    const events = ['mousemove', 'keydown', 'pointerdown', 'touchstart', 'visibilitychange'] as const;
    for (const ev of events) window.addEventListener(ev, bump, { passive: true });
    return () => {
      clearTimeout(timer);
      for (const ev of events) window.removeEventListener(ev, bump);
    };
  }, [user]);

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      loading,
      refresh,
      applyUser: (next) => {
        epoch.current += 1;
        setUser(next ? { ...next, hasPassword: Boolean(next.hasPassword) } : null);
        setLoading(false);
      },
      logout: async () => {
        try {
          await api('/auth/logout', { method: 'POST', body: '{}' });
        } catch (err) {
          console.error(err);
        } finally {
          clearCsrf();
          setUser(null);
        }
      },
    }),
    [user, loading],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth');
  return ctx;
}

export function useRequireAuth() {
  const auth = useAuth();
  const router = useRouter();
  const path = usePathname();

  useEffect(() => {
    if (!auth.loading && !auth.user) {
      router.replace(`/login?next=${encodeURIComponent(path)}`);
    }
  }, [auth.loading, auth.user, router, path]);

  return auth;
}
