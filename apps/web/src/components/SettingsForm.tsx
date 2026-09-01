'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError, clearCsrf, uploadAvatar } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatCooldown } from '@voiceout/shared';
import { Avatar } from '@/components/Avatar';
import { LegalLinks } from '@/components/LegalLinks';
import { PasswordField } from '@/components/PasswordField';

export function SettingsForm({ compact = false }: { compact?: boolean }) {
  const { user, loading, refresh, applyUser, logout } = useAuth();
  const router = useRouter();
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
  const [phoneLink, setPhoneLink] = useState<string | null>(null);
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName);
      setHandle(user.handle);
      setBio(user.bio ?? '');
    }
  }, [user]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/users/me', { method: 'PATCH', body: JSON.stringify({ displayName, handle, bio }) });
      await refresh();
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Could not save');
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
  const passwordLocked = passwordWait > 0;

  return (
    <div className={compact ? 'px-4 py-3' : 'px-4 py-6'}>
      {compact ? null : (
        <>
          <h1 className="text-xl font-bold">Edit profile</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Signed in as <span className="font-medium text-[var(--text)]">{user.email}</span>
          </p>
        </>
      )}

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
        ) : (
          <p className="text-sm text-[var(--muted)]">Name and username can change 7 days after you create the account, then every 7 days after a change.</p>
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
        ) : (
          <p className="text-sm text-[var(--muted)]">Password can change 3 days after you create the account, then every 3 days after a change.</p>
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
        <h2 className="text-base font-semibold">Open on your phone</h2>
        <p className="text-sm text-[var(--muted)]">
          Makes a one-time link that signs this account in on another device. It expires in 90 seconds.
        </p>
        <button
          type="button"
          className="flex min-h-11 items-center rounded-full border border-[var(--line)] px-5 text-sm font-semibold active:bg-[var(--bg)]"
          onClick={() => void makePhoneLink()}
          disabled={phoneBusy}
        >
          {phoneBusy ? 'Making link' : 'Create phone link'}
        </button>
        {phoneLink ? (
          <p className="break-all rounded-xl bg-[var(--bg)] px-3 py-2 text-sm">
            <a className="text-accent underline" href={phoneLink}>
              {phoneLink}
            </a>
          </p>
        ) : null}
      </div>
      <div className="mt-8 space-y-3 border-t border-[var(--line)] pt-5">
        <h2 className="text-base font-semibold text-red-600">Delete account</h2>
        <p className="text-sm text-[var(--muted)]">
          This signs you out and deletes your account, posts, comments, media, and related rows from our
          database. Type DELETE to confirm.
        </p>
        <input
          className="w-full min-h-11 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 text-base"
          value={deleteConfirm}
          onChange={(e) => setDeleteConfirm(e.target.value)}
          placeholder="DELETE"
          autoComplete="off"
        />
        {deleteError ? <p className="text-sm text-red-600">{deleteError}</p> : null}
        <button
          type="button"
          className="flex min-h-11 items-center rounded-full border border-red-200 px-5 text-sm font-semibold text-red-600 active:bg-[var(--bg)] disabled:opacity-60"
          disabled={deleteBusy || deleteConfirm !== 'DELETE'}
          onClick={() => void deleteAccount()}
        >
          {deleteBusy ? 'Deleting' : 'Delete my account'}
        </button>
      </div>
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
