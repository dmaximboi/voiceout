'use client';

import type { MeUser } from '@voiceout/shared';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { PasswordField } from './PasswordField';

export function AdminStepUp({
  user,
  unlocked,
  onUnlocked,
}: {
  user: MeUser;
  unlocked: boolean;
  onUnlocked: (remainingSec: number) => void;
}) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const canEmail = Boolean(user.email && !user.needsRealEmail);

  async function sendCode() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await api('/auth/admin-stepup/code', { method: 'POST', body: '{}' });
      setCodeSent(true);
      setNote('Code sent to your email.');
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Could not send code');
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ remainingSec: number }>('/auth/admin-stepup', {
        method: 'POST',
        body: JSON.stringify(
          codeSent && code.trim()
            ? { code: code.trim() }
            : { password },
        ),
      });
      setPassword('');
      setCode('');
      onUnlocked(data.remainingSec);
      setNote(`Unlocked for about ${Math.ceil(data.remainingSec / 60)} minutes.`);
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Could not confirm');
    } finally {
      setBusy(false);
    }
  }

  if (unlocked) {
    return (
      <div className="mt-6 rounded-2xl border border-[var(--line)] p-4">
        <h2 className="text-base font-semibold">Panel unlocked</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Sensitive actions (suspend, remove, studio) are allowed for a short time on this device.
        </p>
        {note ? <p className="mt-2 text-sm text-[var(--muted)]">{note}</p> : null}
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void confirm(e)} className="mt-6 space-y-3 rounded-2xl border border-[var(--line)] p-4">
      <h2 className="text-base font-semibold">Confirm it is you</h2>
      <p className="text-sm text-[var(--muted)]">
        Required before suspend, remove comment, reject post, or studio changes.
      </p>
      {user.hasPassword ? (
        <PasswordField
          placeholder="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      ) : (
        <p className="text-sm text-[var(--muted)]">This account has no password — use an email code.</p>
      )}
      {canEmail ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void sendCode()}
            className="min-h-11 rounded-full border border-[var(--line)] px-4 text-sm font-semibold disabled:opacity-50"
          >
            {codeSent ? 'Resend email code' : 'Send email code'}
          </button>
          {codeSent ? (
            <input
              className="min-h-11 min-w-[8rem] flex-1 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3"
              placeholder="6-digit code"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          ) : null}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={busy || (!password && !code.trim())}
        className="min-h-11 rounded-full bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50"
      >
        {busy ? 'Checking…' : 'Unlock panel'}
      </button>
      {note ? <p className="text-sm text-[var(--muted)]">{note}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </form>
  );
}

export function useAdminStepUpStatus() {
  const [unlocked, setUnlocked] = useState(false);
  const [remainingSec, setRemainingSec] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ active: boolean; remainingSec: number }>('/auth/admin-stepup/status');
      setUnlocked(data.active);
      setRemainingSec(data.remainingSec);
    } catch {
      setUnlocked(false);
      setRemainingSec(0);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(t);
  }, [refresh]);

  return {
    unlocked,
    remainingSec,
    refresh,
    markUnlocked: (sec: number) => {
      setUnlocked(true);
      setRemainingSec(sec);
    },
  };
}
