'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useEffect, useState } from 'react';
import { api, clearCsrf } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { safeNextPath } from '@/lib/paths';
import type { MeUser } from '@voiceout/shared';
import { Logo } from '@/components/Logo';
import { OAuthButtons } from '@/components/OAuthButtons';
import { LegalLinks } from '@/components/LegalLinks';
import { PasswordField } from '@/components/PasswordField';

export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const { user, loading, applyUser } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get('next'));
  const resetToken = params.get('reset');
  const verifyToken = params.get('verify');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'login' | 'forgot' | 'reset'>(resetToken ? 'reset' : 'login');

  useEffect(() => {
    if (!loading && user) router.replace(next);
  }, [user, loading, router, next]);

  useEffect(() => {
    if (params.get('error') === 'oauth') setError('Sign-in failed. Try again.');
  }, [params]);

  useEffect(() => {
    if (!verifyToken) return;
    void api('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token: verifyToken }) })
      .then(() => {
        setNotice('Email verified. You can log in.');
        router.replace('/login');
      })
      .catch(() => setError('That verify link is invalid or expired.'));
  }, [verifyToken, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const data = await api<{ user: MeUser }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      clearCsrf();
      applyUser(data.user);
      router.replace(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  async function onForgot(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
      setNotice('If that email has a password account, we sent a reset link.');
      setMode('login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send reset email');
    } finally {
      setBusy(false);
    }
  }

  async function onReset(e: FormEvent) {
    e.preventDefault();
    if (!resetToken) return;
    setError(null);
    setBusy(true);
    try {
      await api('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: resetToken, password }),
      });
      setNotice('Password updated. Log in with your new password.');
      setMode('login');
      setPassword('');
      router.replace('/login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset password');
    } finally {
      setBusy(false);
    }
  }

  if (loading || user) {
    return <p className="px-4 py-10 text-center text-sm text-[var(--muted)]">Checking your session.</p>;
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-10">
      <div className="flex justify-center">
        <Logo size={72} />
      </div>
      <h1 className="mt-3 text-center text-2xl font-bold">
        {mode === 'forgot' ? 'Reset password' : mode === 'reset' ? 'Choose a new password' : 'Log in to VoiceOut'}
      </h1>
      {notice ? <p className="mt-3 text-center text-sm text-accent">{notice}</p> : null}

      {mode === 'login' ? (
        <>
          <form onSubmit={(e) => void onSubmit(e)} className="mt-6 space-y-3">
            <input
              className="w-full min-h-11 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 text-base"
              placeholder="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <PasswordField
              placeholder="Password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <button
              className="flex min-h-11 w-full items-center justify-center rounded-full bg-accent font-semibold text-white active:opacity-80 disabled:opacity-60"
              type="submit"
              disabled={busy}
            >
              {busy ? 'Logging in...' : 'Log in'}
            </button>
          </form>
          <button
            type="button"
            className="mt-3 flex min-h-11 w-full items-center justify-center text-sm text-accent active:opacity-70"
            onClick={() => {
              setError(null);
              setMode('forgot');
            }}
          >
            Forgot password?
          </button>
          <div className="mt-4">
            <OAuthButtons next={next} />
          </div>
          <LegalLinks className="mt-6" />
          <p className="mt-4 text-sm text-[var(--muted)]">
            New here?{' '}
            <Link className="text-accent" href={`/register${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`}>
              Create an account
            </Link>
          </p>
        </>
      ) : null}

      {mode === 'forgot' ? (
        <form onSubmit={(e) => void onForgot(e)} className="mt-6 space-y-3">
          <input
            className="w-full min-h-11 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 text-base"
            placeholder="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button
            className="flex min-h-11 w-full items-center justify-center rounded-full bg-accent font-semibold text-white active:opacity-80 disabled:opacity-60"
            type="submit"
            disabled={busy}
          >
            {busy ? 'Sending...' : 'Send reset link'}
          </button>
          <button type="button" className="flex min-h-11 w-full items-center justify-center text-sm text-accent" onClick={() => setMode('login')}>
            Back to log in
          </button>
        </form>
      ) : null}

      {mode === 'reset' ? (
        <form onSubmit={(e) => void onReset(e)} className="mt-6 space-y-3">
          <PasswordField
            placeholder="New password (10+ characters)"
            autoComplete="new-password"
            minLength={10}
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button
            className="flex min-h-11 w-full items-center justify-center rounded-full bg-accent font-semibold text-white active:opacity-80 disabled:opacity-60"
            type="submit"
            disabled={busy}
          >
            {busy ? 'Saving...' : 'Update password'}
          </button>
        </form>
      ) : null}
    </div>
  );
}
