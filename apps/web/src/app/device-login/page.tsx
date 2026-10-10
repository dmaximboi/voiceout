'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError, clearCsrf } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { safeNextPath } from '@/lib/paths';

const claiming = new Map<string, Promise<{ next: string }>>();

function claimHandoff(k: string, next: string) {
  const existing = claiming.get(k);
  if (existing) return existing;
  const request = (async () => {
    clearCsrf();
    return api<{ ok: true; next: string }>('/auth/handoff/claim', {
      method: 'POST',
      body: JSON.stringify({ k, next }),
    });
  })();
  claiming.set(k, request);
  return request;
}

function DeviceLoginInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { refresh } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const k = params.get('k')?.trim() ?? '';
    const next = safeNextPath(params.get('next'));
    if (!k) {
      setError('Missing sign-in link');
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const data = await claimHandoff(k, next);
        if (cancelled) return;
        clearCsrf();
        await refresh();
        router.replace(safeNextPath(data.next));
      } catch (err) {
        if (cancelled) return;
        try {
          await refresh();
          const me = await api<{ user: { id: string } }>('/auth/me');
          if (me.user?.id) {
            router.replace(next);
            return;
          }
        } catch {
          /* still unsigned-in */
        }
        setError(err instanceof ApiError || err instanceof Error ? err.message : 'Sign-in failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params, refresh, router]);

  if (error) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-sm text-red-600">{error}</p>
        <a
          href="/login"
          className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-accent"
        >
          Go to login
        </a>
      </div>
    );
  }

  return <p className="px-4 py-16 text-center text-sm text-[var(--muted)]">Signing you in…</p>;
}

export default function DeviceLoginPage() {
  return (
    <Suspense
      fallback={
        <p className="px-4 py-16 text-center text-sm text-[var(--muted)]">Signing you in…</p>
      }
    >
      <DeviceLoginInner />
    </Suspense>
  );
}
