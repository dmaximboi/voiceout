'use client';

import { FormEvent, useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';
import { canViewModeration } from '@/lib/safetyState';
import { ModeratorPanel } from '@/components/SafetySettings';
import { AdminStepUp, useAdminStepUpStatus } from '@/components/AdminStepUp';

export default function SwitchAcctPage() {
  const { user, loading, refresh } = useRequireAuth();
  const step = useAdminStepUpStatus();
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [deviceMsg, setDeviceMsg] = useState<string | null>(null);
  const [deviceErr, setDeviceErr] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user || !canViewModeration(user.role)) notFound();
  }, [loading, user]);

  if (loading || !user) {
    return <p className="p-6 text-sm text-[var(--muted)]">Checking your session.</p>;
  }
  if (!canViewModeration(user.role)) return null;

  async function bindDevice() {
    setDeviceBusy(true);
    setDeviceErr(null);
    setDeviceMsg(null);
    try {
      await api('/auth/switch-device', { method: 'POST', body: '{}' });
      await refresh();
      setDeviceMsg('This device is linked.');
    } catch (err) {
      setDeviceErr(
        err instanceof ApiError || err instanceof Error ? err.message : 'Could not link this device',
      );
    } finally {
      setDeviceBusy(false);
    }
  }

  return (
    <div className="px-4 py-6 pb-24">
      <h1 className="text-xl font-bold">Switch account</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Moderation tools stay on this path. Link a device, then confirm your identity for sensitive actions.
      </p>

      <div className="mt-6 space-y-2 rounded-2xl border border-[var(--line)] p-4">
        <h2 className="text-base font-semibold">1. This device</h2>
        <p className="text-sm text-[var(--muted)]">
          Link this browser once. Other devices stay locked out of this panel.
        </p>
        <button
          type="button"
          disabled={deviceBusy}
          onClick={() => void bindDevice()}
          className="min-h-11 rounded-full bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          {deviceBusy ? 'Linking…' : 'Link this device'}
        </button>
        {deviceMsg ? <p className="text-sm text-[var(--muted)]">{deviceMsg}</p> : null}
        {deviceErr ? <p className="text-sm text-red-600">{deviceErr}</p> : null}
      </div>

      <div className="mt-2">
        <p className="mb-1 text-sm font-semibold text-[var(--muted)]">2. Confirm identity</p>
        <AdminStepUp
          user={user}
          unlocked={step.unlocked}
          onUnlocked={(sec) => {
            step.markUnlocked(sec);
          }}
        />
      </div>

      <p className="mt-6 text-sm">
        Open the full console at{' '}
        <a href="/admin" className="font-semibold text-accent underline">
          /admin
        </a>
        .
      </p>
      {user.role === 'admin' ? <StudioGrant unlocked={step.unlocked} onNeedUnlock={() => void step.refresh()} /> : null}
      <ModeratorPanel
        role={user.role as 'moderator' | 'admin'}
        unlocked={step.unlocked}
        onNeedUnlock={() => void step.refresh()}
      />
    </div>
  );
}

function StudioGrant({ unlocked, onNeedUnlock }: { unlocked: boolean; onNeedUnlock: () => void }) {
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function grant(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    if (!unlocked) {
      setError('Unlock the panel first.');
      onNeedUnlock();
      return;
    }
    try {
      const data = await api<{ users: { id: string; handle: string }[] }>(
        `/admin/users/search?q=${encodeURIComponent(query.trim())}`,
      );
      const match = data.users.find((u) => u.handle.toLowerCase() === query.trim().toLowerCase()) ?? data.users[0];
      if (!match) {
        setError('No user found.');
        return;
      }
      await api(`/admin/users/${match.id}/studio`, { method: 'POST', body: JSON.stringify({ days: 30 }) });
      setMessage(`Studio granted to @${match.handle} for 30 days.`);
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Grant failed');
      if (err instanceof ApiError && err.extra.code === 'ADMIN_STEPUP_REQUIRED') onNeedUnlock();
    }
  }

  return (
    <form onSubmit={(e) => void grant(e)} className="mt-6 space-y-2 rounded-2xl border border-[var(--line)] p-4">
      <h2 className="text-base font-semibold">Quick studio grant</h2>
      <input
        className="min-h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3"
        placeholder="Handle"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <button type="submit" className="min-h-11 rounded-full bg-accent px-4 text-sm font-semibold text-white">
        Grant 30 days
      </button>
      {message ? <p className="text-sm text-[var(--muted)]">{message}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </form>
  );
}
