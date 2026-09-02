'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useEffect, useState } from 'react';
import { api, clearCsrf, uploadAvatar } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { safeNextPath } from '@/lib/paths';
import type { MeUser } from '@voiceout/shared';
import { Logo } from '@/components/Logo';
import { OAuthButtons } from '@/components/OAuthButtons';
import { LegalLinks } from '@/components/LegalLinks';
import { PasswordField } from '@/components/PasswordField';

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterPageInner />
    </Suspense>
  );
}

function RegisterPageInner() {
  const { user, loading, applyUser } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) router.replace(next);
  }, [user, loading, router, next]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!photo) {
      setError('Add a photo');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const created = await api<{ user: MeUser }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, handle: handle.toLowerCase(), displayName }),
      });
      clearCsrf();
      applyUser(created.user);
      try {
        await uploadAvatar(photo);
        const me = await api<{ user: MeUser }>('/auth/me');
        applyUser(me.user);
      } catch {
        /* account is live; photo can be set in settings */
      }
      try {
        sessionStorage.setItem(
          'vo_notice',
          'Account created. Verify your email in your Gmail (or inbox) to post.',
        );
      } catch {
        /* private mode */
      }
      router.replace(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not register');
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
      <h1 className="mt-3 text-center text-2xl font-bold">Join VoiceOut</h1>
      <form onSubmit={(e) => void onSubmit(e)} className="mt-6 space-y-3">
        <label className="mx-auto flex w-28 cursor-pointer flex-col items-center gap-2">
          <span className="grid h-24 w-24 overflow-hidden rounded-full bg-[var(--bg)] ring-1 ring-[var(--line)]">
            {preview ? (
              <img src={preview} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="grid h-full w-full place-items-center text-sm font-semibold text-[var(--muted)]">Photo</span>
            )}
          </span>
          <input
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/*"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setPhoto(f);
              setPreview(f ? URL.createObjectURL(f) : null);
            }}
          />
        </label>
        <input
          className="w-full min-h-11 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 text-base"
          placeholder="Display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
        />
        <input
          className="w-full min-h-11 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 text-base"
          placeholder="handle"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          required
        />
        <input
          className="w-full min-h-11 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 text-base"
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <PasswordField
          placeholder="Password (10+ characters)"
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
          disabled={busy || !photo}
        >
          {busy ? 'Creating...' : 'Create account'}
        </button>
      </form>
      <div className="mt-4">
        <OAuthButtons next={next} />
      </div>
      <LegalLinks className="mt-4" />
      <p className="mt-3 text-center text-xs text-[var(--muted)]">A profile photo helps people recognize you.</p>
      <p className="mt-6 text-sm">
        Already have an account?{' '}
        <Link className="text-accent" href={`/login${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`}>
          Log in
        </Link>
      </p>
    </div>
  );
}
