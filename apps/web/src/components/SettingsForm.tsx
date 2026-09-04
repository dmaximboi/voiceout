'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useEffect, useState } from 'react';
import { api, ApiError, clearCsrf, uploadAvatar } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatCooldown, type PlanTier } from '@voiceout/shared';
import { Avatar } from '@/components/Avatar';
import { LegalLinks } from '@/components/LegalLinks';
import { PasswordField } from '@/components/PasswordField';
import { PlanSubscribeSheet } from '@/components/PlanSubscribeSheet';
import { planStatusLabel, SettingsMorePanel } from '@/components/SettingsMorePanel';

export function SettingsForm({ compact = false }: { compact?: boolean }) {
  return (
    <Suspense>
      <SettingsFormInner compact={compact} />
    </Suspense>
  );
}

function SettingsFormInner({ compact = false }: { compact?: boolean }) {
  const { user, loading, refresh, applyUser, logout } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle] = useState('');
  const [bio, setBio] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saved, setSaved] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [verifySent, setVerifySent] = useState(false);
  const [phoneLink, setPhoneLink] = useState<string | null>(null);
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [planSheetOpen, setPlanSheetOpen] = useState(false);
  const [subBusy, setSubBusy] = useState(false);
  const [subBusyTier, setSubBusyTier] = useState<PlanTier | null>(null);
  const [subError, setSubError] = useState<string | null>(null);
  const [subNote, setSubNote] = useState<string | null>(null);
  const [nameCode, setNameCode] = useState('');
  const [nameCodeSent, setNameCodeSent] = useState(false);
  const [nameCodeBusy, setNameCodeBusy] = useState(false);
  const [linkEmail, setLinkEmail] = useState('');
  const [linkCode, setLinkCode] = useState('');
  const [linkSent, setLinkSent] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [phoneInput, setPhoneInput] = useState('');
  const [phoneBusySave, setPhoneBusySave] = useState(false);

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName);
      setHandle(user.handle);
      setBio(user.bio ?? '');
    }
  }, [user]);

  useEffect(() => {
    const plan = searchParams.get('plan');
    const studio = searchParams.get('studio');
    const cancel = plan === 'cancel' || studio === 'cancel';
    const ok = plan === 'ok' || studio === 'ok';
    if (cancel) {
      setSubNote('Checkout canceled.');
      router.replace('/settings', { scroll: false });
      return;
    }
    if (!ok) return;
    let cancelled = false;
    const checkoutId = searchParams.get('checkout_id') ?? undefined;
    const tierParam = searchParams.get('tier');
    const tier =
      tierParam === 'basic' || tierParam === 'verified' || tierParam === 'gold' ? tierParam : undefined;
    setSubNote('Confirming payment…');
    void (async () => {
      const delays = [0, 2000, 4000, 8000];
      for (let i = 0; i < delays.length; i++) {
        if (delays[i]! > 0) await new Promise((r) => setTimeout(r, delays[i]!));
        if (cancelled) return;
        try {
          const result = await api<{ ok: boolean; planTier?: PlanTier; isStudio?: boolean }>(
            '/billing/plans/confirm',
            {
              method: 'POST',
              body: JSON.stringify({ checkoutId, tier }),
            },
          );
          if (cancelled) return;
          if (result.ok || result.planTier || result.isStudio) {
            await refresh();
            setSubNote('Payment confirmed. Your plan is active.');
            router.replace('/settings', { scroll: false });
            return;
          }
          setSubNote('Payment is still processing…');
        } catch (err) {
          if (cancelled) return;
          if (i === delays.length - 1) {
            setSubNote(
              err instanceof Error
                ? `${err.message} Refresh shortly, or wait for the webhook.`
                : 'Could not confirm payment yet. Refresh shortly.',
            );
            void refresh();
            router.replace('/settings', { scroll: false });
            return;
          }
        }
      }
      if (!cancelled) {
        setSubNote('Payment is still processing. Refresh in a moment.');
        router.replace('/settings', { scroll: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams, refresh, router]);

  async function startPlanCheckout(tier: PlanTier) {
    setSubBusy(true);
    setSubBusyTier(tier);
    setSubError(null);
    try {
      const data = await api<{ checkoutUrl: string }>('/billing/plans/checkout', {
        method: 'POST',
        body: JSON.stringify({ tier }),
      });
      window.location.href = data.checkoutUrl;
    } catch (err) {
      setSubError(err instanceof ApiError || err instanceof Error ? err.message : 'Could not start checkout');
      setSubBusy(false);
      setSubBusyTier(null);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const renaming =
        Boolean(user) && (displayName !== user!.displayName || handle !== user!.handle);
      if (renaming && !nameCodeSent) {
        setError('Request a verification code before changing your name or username');
        return;
      }
      await api('/users/me', {
        method: 'PATCH',
        body: JSON.stringify({
          displayName,
          handle,
          bio,
          ...(renaming ? { verificationCode: nameCode } : {}),
        }),
      });
      await refresh();
      setNameCode('');
      setNameCodeSent(false);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Could not save');
    }
  }

  async function requestNameCode() {
    setError(null);
    setNameCodeBusy(true);
    try {
      await api('/users/me/name-code', {
        method: 'POST',
        body: JSON.stringify({ displayName, handle }),
      });
      setNameCodeSent(true);
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Could not send code');
    } finally {
      setNameCodeBusy(false);
    }
  }

  async function requestEmailLink() {
    setLinkError(null);
    setLinkBusy(true);
    try {
      await api('/users/me/email/link', {
        method: 'POST',
        body: JSON.stringify({ email: linkEmail.trim() }),
      });
      setLinkSent(true);
    } catch (err) {
      setLinkError(err instanceof ApiError || err instanceof Error ? err.message : 'Could not send code');
    } finally {
      setLinkBusy(false);
    }
  }

  async function confirmEmailLink() {
    setLinkError(null);
    setLinkBusy(true);
    try {
      await api('/users/me/email/confirm', {
        method: 'POST',
        body: JSON.stringify({ email: linkEmail.trim(), code: linkCode.trim() }),
      });
      await refresh();
      setLinkSent(false);
      setLinkCode('');
    } catch (err) {
      setLinkError(err instanceof ApiError || err instanceof Error ? err.message : 'Could not confirm email');
    } finally {
      setLinkBusy(false);
    }
  }

  async function savePhone() {
    setError(null);
    setPhoneBusySave(true);
    try {
      await api('/users/me/phone', {
        method: 'POST',
        body: JSON.stringify({ phone: phoneInput.trim() }),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Could not save phone');
    } finally {
      setPhoneBusySave(false);
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    try {
      await api('/users/me/password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: currentPassword || undefined,
          newPassword,
          confirmPassword,
        }),
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      await refresh();
      setPasswordSaved(true);
      window.setTimeout(() => setPasswordSaved(false), 1600);
    } catch (err) {
      console.error(err);
      setPasswordError(err instanceof ApiError || err instanceof Error ? err.message : 'Could not update password');
    }
  }

  async function onAvatar(file: File) {
    setError(null);
    try {
      await uploadAvatar(file);
      await refresh();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Could not update photo');
    }
  }

  async function makePhoneLink() {
    setError(null);
    setPhoneBusy(true);
    try {
      const { k } = await api<{ k: string }>('/auth/device-link', { method: 'POST', body: '{}' });
      setPhoneLink(`${window.location.origin}/vo-api/auth/handoff?k=${encodeURIComponent(k)}&next=/settings`);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Could not make a phone link');
    } finally {
      setPhoneBusy(false);
    }
  }

  async function deleteAccount() {
    setDeleteError(null);
    setDeleteBusy(true);
    try {
      await api('/users/me', { method: 'DELETE', body: JSON.stringify({ confirm: 'DELETE' }) });
      clearCsrf();
      applyUser(null);
      router.push('/login');
    } catch (err) {
      console.error(err);
      setDeleteError(err instanceof ApiError || err instanceof Error ? err.message : 'Could not delete account');
    } finally {
      setDeleteBusy(false);
    }
  }

  if (loading) {
    return <p className="p-4 text-sm text-[var(--muted)]">Checking your session.</p>;
  }

  if (!user) {
    return (
      <div className="p-4">
        <p className="text-sm text-[var(--muted)]">Log in to edit your profile.</p>
        <button
          type="button"
          className="mt-3 flex min-h-11 w-full items-center justify-center rounded-full bg-accent text-sm font-semibold text-white active:opacity-80"
          onClick={() => router.push('/login?next=/me')}
        >
          Log in
        </button>
      </div>
    );
  }

  const nameWait = Math.max(0, new Date(user.nameChangeAvailableAt).getTime() - Date.now());
  const passwordWait = Math.max(0, new Date(user.passwordChangeAvailableAt).getTime() - Date.now());
  const nameLocked = nameWait > 0;
  const passwordLocked = passwordWait > 0 && user.hasPassword;
  const renaming = displayName !== user.displayName || handle !== user.handle;

  return (
    <div className={compact ? 'px-4 py-3' : 'px-4 py-6'}>
      {compact ? null : (
        <>
          <h1 className="text-xl font-bold">Edit profile</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Signed in as{' '}
            <span className="font-medium text-[var(--text)]">
              {user.needsRealEmail ? 'Telegram account' : user.email}
            </span>
          </p>
        </>
      )}

      {user.needsRealEmail ? (
        <div className="mt-5 space-y-3 rounded-xl border border-amber-300 p-3">
          <p className="text-sm font-semibold">Add your email</p>
          <p className="text-sm text-[var(--muted)]">
            Required to change your name. If this email already has an account, log in there instead.
          </p>
          <input
            className="w-full min-h-11 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 text-base"
            type="email"
            placeholder="you@gmail.com"
            value={linkEmail}
            onChange={(e) => setLinkEmail(e.target.value)}
          />
          {linkSent ? (
            <input
              className="w-full min-h-11 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 text-base"
              inputMode="numeric"
              maxLength={6}
              placeholder="6-digit code"
              value={linkCode}
              onChange={(e) => setLinkCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          ) : null}
          {linkError ? <p className="text-sm text-red-600">{linkError}</p> : null}
          <button
            type="button"
            disabled={linkBusy || !linkEmail.trim() || (linkSent && linkCode.length !== 6)}
            className="flex min-h-11 items-center rounded-full bg-accent px-5 text-sm font-semibold text-white disabled:opacity-60"
            onClick={() => void (linkSent ? confirmEmailLink() : requestEmailLink())}
          >
            {linkBusy ? 'Working…' : linkSent ? 'Confirm email' : 'Send code'}
          </button>
          <div className="border-t border-[var(--line)] pt-3">
            <p className="text-sm font-medium">Phone (optional)</p>
            <input
              className="mt-1 w-full min-h-11 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 text-base"
              placeholder={user.phone ?? '+234…'}
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
            />
            <button
              type="button"
              disabled={phoneBusySave || !phoneInput.trim()}
              className="mt-2 flex min-h-11 items-center rounded-full border border-[var(--line)] px-5 text-sm font-semibold disabled:opacity-60"
              onClick={() => void savePhone()}
            >
              {phoneBusySave ? 'Saving…' : 'Save phone'}
            </button>
          </div>
        </div>
      ) : null}

      {user.hasPassword && !user.isEmailVerified && !user.needsRealEmail ? (
        <div className="mt-5 rounded-xl border border-amber-300 p-3">
          <p className="text-sm">Account created. Verify your email in your Gmail (or inbox) to post and rename.</p>
          <button
            type="button"
            className="mt-2 text-sm font-semibold text-accent"
            onClick={() =>
              void api('/auth/resend-verify', { method: 'POST', body: '{}' }).then(() => setVerifySent(true))
            }
          >
            {verifySent ? 'Verification email sent' : 'Resend verification email'}
          </button>
        </div>
      ) : null}

      <div className={`flex items-center gap-4 ${compact ? '' : 'mt-6'}`}>
        <Avatar name={user.displayName} src={user.avatarUrl} size={compact ? 'sm' : 'lg'} />
        <label className="text-sm font-medium text-accent">
          Change photo
          <input
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onAvatar(f);
            }}
          />
        </label>
      </div>

      <form onSubmit={(e) => void save(e)} className="mt-4 space-y-3">
        <label className="block text-sm font-medium">
          Name
          <input
            className="mt-1 w-full min-h-11 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 text-base font-normal disabled:opacity-60"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            disabled={nameLocked}
          />
        </label>
        <label className="block text-sm font-medium">
          Username
          <input
            className="mt-1 w-full min-h-11 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 text-base font-normal disabled:opacity-60"
            value={handle}
            onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
            required
            disabled={nameLocked}
          />
        </label>
        {nameLocked ? (
          <p className="text-sm text-[var(--muted)]">
            Name and username can change in {formatCooldown(nameWait)}.
          </p>
        ) : renaming ? (
          <div className="space-y-2 rounded-xl border border-[var(--line)] p-3">
            <p className="text-sm text-[var(--muted)]">
              Changing name or username needs a code sent to your email.
            </p>
            <button
              type="button"
              disabled={nameCodeBusy || user.needsRealEmail || !user.isEmailVerified}
              className="flex min-h-11 items-center rounded-full border border-[var(--line)] px-4 text-sm font-semibold disabled:opacity-60"
              onClick={() => void requestNameCode()}
            >
              {nameCodeBusy ? 'Sending…' : nameCodeSent ? 'Resend code' : 'Send verification code'}
            </button>
            {nameCodeSent ? (
              <input
                className="w-full min-h-11 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 text-base"
                inputMode="numeric"
                maxLength={6}
                placeholder="6-digit code"
                value={nameCode}
                onChange={(e) => setNameCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-[var(--muted)]">
            Change your name with an email code. After a change, wait 7 days before another rename.
          </p>
        )}
        <label className="block text-sm font-medium">
          Bio
          <textarea
            className="mt-1 w-full min-h-[4.5rem] rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-base font-normal"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={160}
            placeholder="Where you're from and the language you speak helps people near you find your voices"
          />
        </label>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button className="flex min-h-11 items-center rounded-full bg-accent px-5 text-sm font-semibold text-white active:opacity-80" type="submit">
          {saved ? 'Saved' : 'Save profile'}
        </button>
      </form>

      <form onSubmit={(e) => void changePassword(e)} className="mt-8 space-y-3 border-t border-[var(--line)] pt-5">
        <h2 className="text-base font-semibold">{user.hasPassword ? 'Change password' : 'Set a password'}</h2>
        {passwordLocked ? (
          <p className="text-sm text-[var(--muted)]">Password can change in {formatCooldown(passwordWait)}.</p>
        ) : user.hasPassword ? (
          <p className="text-sm text-[var(--muted)]">Password can change every 3 days after a change.</p>
        ) : (
          <p className="text-sm text-[var(--muted)]">Add a password so you can also sign in with email.</p>
        )}
        {user.hasPassword ? (
          <PasswordField
            placeholder="Current password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            disabled={passwordLocked}
          />
        ) : (
          <p className="text-sm text-[var(--muted)]">You signed in with a connected account. You can add a password to also log in with email.</p>
        )}
        <PasswordField
          placeholder="New password (10+ characters)"
          minLength={10}
          maxLength={128}
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          disabled={passwordLocked}
        />
        <PasswordField
          placeholder="Confirm new password"
          minLength={10}
          maxLength={128}
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          disabled={passwordLocked}
        />
        {passwordError ? <p className="text-sm text-red-600">{passwordError}</p> : null}
        <button
          className="flex min-h-11 items-center rounded-full border border-[var(--line)] px-5 text-sm font-semibold active:bg-[var(--bg)] disabled:opacity-60"
          type="submit"
          disabled={passwordLocked}
        >
          {passwordSaved ? 'Updated' : user.hasPassword ? 'Update password' : 'Set password'}
        </button>
      </form>

      {compact ? null : <LegalLinks className="mt-10" />}
      <div className="mt-8 space-y-3 border-t border-[var(--line)] pt-5">
        <h2 className="text-base font-semibold">Subscription</h2>
        <p className="text-sm text-[var(--muted)]">
          {user.planTier
            ? `${planStatusLabel(user.planTier)} plan active${user.planUntil ? ` until ${new Date(user.planUntil).toLocaleDateString()}` : ''}.`
            : 'Unlock longer recordings, caption edits, and delete-anytime from $1.'}
        </p>
        <button
          type="button"
          disabled={subBusy}
          onClick={() => setPlanSheetOpen(true)}
          className="flex min-h-11 items-center rounded-full bg-accent px-5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {user.planTier ? 'Change plan' : 'Subscribe'}
        </button>
        {subNote ? <p className="text-sm text-[var(--muted)]">{subNote}</p> : null}
        {subError ? <p className="text-sm text-red-600">{subError}</p> : null}
      </div>

      <SettingsMorePanel
        user={user}
        phoneLink={phoneLink}
        phoneBusy={phoneBusy}
        onMakePhoneLink={() => void makePhoneLink()}
        deleteConfirm={deleteConfirm}
        setDeleteConfirm={setDeleteConfirm}
        deleteBusy={deleteBusy}
        deleteError={deleteError}
        onDeleteAccount={() => void deleteAccount()}
      />

      <PlanSubscribeSheet
        open={planSheetOpen}
        currentTier={user.planTier}
        busyTier={subBusyTier}
        onClose={() => setPlanSheetOpen(false)}
        onSelect={(tier) => void startPlanCheckout(tier)}
      />

      <button
        type="button"
        className="mt-6 flex min-h-11 items-center rounded-full border border-red-200 px-5 text-sm font-semibold text-red-600 active:bg-[var(--bg)]"
        onClick={() => void logout().then(() => router.push('/login'))}
      >
        Log out
      </button>
    </div>
  );
}
