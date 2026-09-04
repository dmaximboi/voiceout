'use client';

import type { MeUser, PublicUser, ReportSubmission } from '@voiceout/shared';
import { PLAN_DEFINITIONS, formatCooldown, type PlanTier } from '@voiceout/shared';
import {
  ArrowLeft,
  Bug,
  CreditCard,
  Flag,
  KeyRound,
  Smartphone,
  Trash2,
  UserX,
} from 'lucide-react';
import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError, uploadPostImage } from '@/lib/api';
import { Avatar } from '@/components/Avatar';
import { PasswordField } from '@/components/PasswordField';
import { canViewModeration } from '@/lib/safetyState';

type Panel = 'menu' | 'password' | 'plan' | 'bug' | 'report' | 'blocked' | 'phone' | 'delete';

const ICON_BTN =
  'flex min-h-[4.5rem] flex-col items-center justify-center gap-1 rounded-2xl border border-[var(--line)] bg-[var(--bg)] px-2 py-3 text-xs font-semibold active:bg-[var(--card)]';

export function SettingsMorePanel({
  user,
  phoneLink,
  phoneBusy,
  onMakePhoneLink,
  deleteConfirm,
  setDeleteConfirm,
  deleteBusy,
  deleteError,
  onDeleteAccount,
  currentPassword,
  setCurrentPassword,
  newPassword,
  setNewPassword,
  confirmPassword,
  setConfirmPassword,
  passwordError,
  passwordSaved,
  passwordLocked,
  passwordWait,
  onChangePassword,
  subNote,
  subError,
  subBusy,
  onOpenPlanSheet,
}: {
  user: MeUser;
  phoneLink: string | null;
  phoneBusy: boolean;
  onMakePhoneLink: () => void;
  deleteConfirm: string;
  setDeleteConfirm: (v: string) => void;
  deleteBusy: boolean;
  deleteError: string | null;
  onDeleteAccount: () => void;
  currentPassword: string;
  setCurrentPassword: (v: string) => void;
  newPassword: string;
  setNewPassword: (v: string) => void;
  confirmPassword: string;
  setConfirmPassword: (v: string) => void;
  passwordError: string | null;
  passwordSaved: boolean;
  passwordLocked: boolean;
  passwordWait: number;
  onChangePassword: (e: FormEvent) => void;
  subNote: string | null;
  subError: string | null;
  subBusy: boolean;
  onOpenPlanSheet: () => void;
}) {
  const [panel, setPanel] = useState<Panel>('menu');

  return (
    <div className="mt-8 border-t border-[var(--line)] pt-5">
      {panel === 'menu' ? (
        <>
          <h2 className="text-base font-semibold">More options</h2>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <button type="button" className={ICON_BTN} onClick={() => setPanel('password')} aria-label="Password">
              <KeyRound className="h-6 w-6 text-[var(--muted)]" />
              Password
            </button>
            <button type="button" className={ICON_BTN} onClick={() => setPanel('plan')} aria-label="Plan">
              <CreditCard className="h-6 w-6 text-[var(--muted)]" />
              {user.planTier ? 'Plan' : 'Subscribe'}
            </button>
            <button type="button" className={ICON_BTN} onClick={() => setPanel('bug')} aria-label="Report a bug">
              <Bug className="h-6 w-6 text-[var(--muted)]" />
              Bug
            </button>
            <button type="button" className={ICON_BTN} onClick={() => setPanel('report')} aria-label="Report an account">
              <Flag className="h-6 w-6 text-[var(--muted)]" />
              Report
            </button>
            <button type="button" className={ICON_BTN} onClick={() => setPanel('blocked')} aria-label="Blocked accounts">
              <UserX className="h-6 w-6 text-[var(--muted)]" />
              Blocked
            </button>
            <button type="button" className={ICON_BTN} onClick={() => setPanel('phone')} aria-label="Open on phone">
              <Smartphone className="h-6 w-6 text-[var(--muted)]" />
              Phone
            </button>
            <button type="button" className={`${ICON_BTN} text-red-600`} onClick={() => setPanel('delete')} aria-label="Delete account">
              <Trash2 className="h-6 w-6" />
              Delete
            </button>
          </div>
          {canViewModeration(user.role) ? (
            <Link
              href="/switch-acct"
              className="mt-4 flex min-h-11 items-center justify-center rounded-full border border-[var(--line)] px-5 text-sm font-semibold"
            >
              Switch account
            </Link>
          ) : null}
        </>
      ) : (
        <PanelShell title={panelTitle(panel, user)} onBack={() => setPanel('menu')}>
          {panel === 'password' ? (
            <PasswordPanel
              user={user}
              currentPassword={currentPassword}
              setCurrentPassword={setCurrentPassword}
              newPassword={newPassword}
              setNewPassword={setNewPassword}
              confirmPassword={confirmPassword}
              setConfirmPassword={setConfirmPassword}
              passwordError={passwordError}
              passwordSaved={passwordSaved}
              passwordLocked={passwordLocked}
              passwordWait={passwordWait}
              onChangePassword={onChangePassword}
            />
          ) : null}
          {panel === 'plan' ? (
            <PlanPanel
              user={user}
              subNote={subNote}
              subError={subError}
              subBusy={subBusy}
              onOpenPlanSheet={onOpenPlanSheet}
            />
          ) : null}
          {panel === 'bug' ? <BugReportPanel /> : null}
          {panel === 'report' ? <ReportAccountPanel /> : null}
          {panel === 'blocked' ? <BlockedAccountsPanel /> : null}
          {panel === 'phone' ? (
            <PhoneLinkPanel phoneLink={phoneLink} phoneBusy={phoneBusy} onMakePhoneLink={onMakePhoneLink} />
          ) : null}
          {panel === 'delete' ? (
            <DeleteAccountPanel
              deleteConfirm={deleteConfirm}
              setDeleteConfirm={setDeleteConfirm}
              deleteBusy={deleteBusy}
              deleteError={deleteError}
              onDeleteAccount={onDeleteAccount}
            />
          ) : null}
        </PanelShell>
      )}
    </div>
  );
}

function panelTitle(panel: Panel, user: MeUser) {
  if (panel === 'password') return user.hasPassword ? 'Change password' : 'Set a password';
  if (panel === 'plan') return 'Subscription';
  if (panel === 'bug') return 'Report a bug';
  if (panel === 'report') return 'Report an account';
  if (panel === 'blocked') return 'Blocked accounts';
  if (panel === 'phone') return 'Open on your phone';
  if (panel === 'delete') return 'Delete account';
  return 'More options';
}

function PanelShell({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Back" className="min-h-10 min-w-10 rounded-full border border-[var(--line)]" onClick={onBack}>
          <ArrowLeft className="mx-auto h-5 w-5" />
        </button>
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      <div className="mt-4">{children}</div>
    </>
  );
}

function PasswordPanel({
  user,
  currentPassword,
  setCurrentPassword,
  newPassword,
  setNewPassword,
  confirmPassword,
  setConfirmPassword,
  passwordError,
  passwordSaved,
  passwordLocked,
  passwordWait,
  onChangePassword,
}: {
  user: MeUser;
  currentPassword: string;
  setCurrentPassword: (v: string) => void;
  newPassword: string;
  setNewPassword: (v: string) => void;
  confirmPassword: string;
  setConfirmPassword: (v: string) => void;
  passwordError: string | null;
  passwordSaved: boolean;
  passwordLocked: boolean;
  passwordWait: number;
  onChangePassword: (e: FormEvent) => void;
}) {
  return (
    <form onSubmit={onChangePassword} className="space-y-3">
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
        <p className="text-sm text-[var(--muted)]">
          You signed in with a connected account. You can add a password to also log in with email.
        </p>
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
  );
}

function PlanPanel({
  user,
  subNote,
  subError,
  subBusy,
  onOpenPlanSheet,
}: {
  user: MeUser;
  subNote: string | null;
  subError: string | null;
  subBusy: boolean;
  onOpenPlanSheet: () => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--muted)]">
        {user.planTier
          ? `${planStatusLabel(user.planTier)} plan active${user.planUntil ? ` until ${new Date(user.planUntil).toLocaleDateString()}` : ''}.`
          : 'Unlock longer recordings, caption edits, and delete-anytime from $1.'}
      </p>
      <button
        type="button"
        disabled={subBusy}
        onClick={onOpenPlanSheet}
        className="flex min-h-11 items-center rounded-full bg-accent px-5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {user.planTier ? 'Change plan' : 'Subscribe'}
      </button>
      {subNote ? <p className="text-sm text-[var(--muted)]">{subNote}</p> : null}
      {subError ? <p className="text-sm text-red-600">{subError}</p> : null}
    </div>
  );
}

function BugReportPanel() {
  const [description, setDescription] = useState('');
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [stage, setStage] = useState<'idle' | 'uploading' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!screenshot) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(screenshot);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [screenshot]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      let screenshotMediaId: string | undefined;
      if (screenshot) {
        setStage('uploading');
        screenshotMediaId = await uploadPostImage(screenshot);
      }
      setStage('sending');
      await api('/bug-feedback', {
        method: 'POST',
        body: JSON.stringify({ description: description.trim(), screenshotMediaId }),
      });
      setDescription('');
      setScreenshot(null);
      setStage('sent');
    } catch (err) {
      setStage('idle');
      setError(err instanceof Error ? err.message : 'Could not send feedback');
    }
  }

  return (
    <>
      <p className="text-sm text-[var(--muted)]">Tell us what went wrong. Safety reports on posts and profiles use Report.</p>
      <form className="mt-3 space-y-3" onSubmit={(e) => void submit(e)}>
        <textarea
          required
          maxLength={1000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What happened?"
          className="min-h-28 w-full rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3 text-base"
        />
        <label className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-[var(--line)] px-4 text-sm font-semibold">
          Add screenshot
          <input
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => setScreenshot(e.target.files?.[0] ?? null)}
          />
        </label>
        {preview ? <img src={preview} alt="" className="max-h-40 rounded-xl border border-[var(--line)] object-contain" /> : null}
        {stage === 'sent' ? <p className="text-sm font-semibold text-green-700">Bug report sent. Thank you.</p> : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button
          type="submit"
          disabled={!description.trim() || stage === 'uploading' || stage === 'sending'}
          className="min-h-11 rounded-full bg-accent px-5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {stage === 'uploading' || stage === 'sending' ? 'Sending…' : 'Send bug report'}
        </button>
      </form>
    </>
  );
}

function ReportAccountPanel() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PublicUser[]>([]);
  const [selected, setSelected] = useState<PublicUser | null>(null);
  const [reason, setReason] = useState<ReportSubmission['reason']>('spam');
  const [details, setDetails] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = window.setTimeout(() => {
      void api<{ users: PublicUser[] }>(`/search/users?q=${encodeURIComponent(query.trim())}&limit=8`)
        .then((d) => setResults(d.users))
        .catch(() => setResults([]));
    }, 300);
    return () => window.clearTimeout(t);
  }, [query]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await api('/reports', {
        method: 'POST',
        body: JSON.stringify({
          targetType: 'user',
          targetId: selected.id,
          reason,
          ...(details.trim() ? { details: details.trim() } : {}),
          alsoBlock,
        }),
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Could not send report');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return <p className="text-sm font-semibold text-green-700">Report received.{alsoBlock ? ' Account blocked.' : ''}</p>;
  }

  return (
    <form className="space-y-3" onSubmit={(e) => void submit(e)}>
      <p className="text-sm text-[var(--muted)]">Search by username or name. Moderators review reports.</p>
      <input
        className="w-full min-h-11 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 text-base"
        placeholder="@username"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected(null);
        }}
      />
      {results.length > 0 && !selected ? (
        <ul className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)]">
          {results.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 px-3 py-2 text-left"
                onClick={() => {
                  setSelected(u);
                  setQuery(`@${u.handle}`);
                  setResults([]);
                }}
              >
                <Avatar name={u.displayName} src={u.avatarUrl} size="sm" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{u.displayName}</span>
                  <span className="block truncate text-xs text-[var(--muted)]">@{u.handle}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {selected ? (
        <>
          <select
            className="min-h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3"
            value={reason}
            onChange={(e) => setReason(e.target.value as ReportSubmission['reason'])}
          >
            <option value="spam">Spam</option>
            <option value="abuse">Abuse or harassment</option>
            <option value="illegal">Illegal content</option>
            <option value="other">Other</option>
          </select>
          <textarea
            className="min-h-20 w-full rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3 text-base"
            maxLength={500}
            placeholder="Details (optional)"
            value={details}
            onChange={(e) => setDetails(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={alsoBlock} onChange={(e) => setAlsoBlock(e.target.checked)} />
            Block this account (hide from feed and search)
          </label>
        </>
      ) : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        type="submit"
        disabled={!selected || busy}
        className="min-h-11 rounded-full bg-red-600 px-5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {busy ? 'Sending…' : 'Send report'}
      </button>
    </form>
  );
}

function BlockedAccountsPanel() {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ users: PublicUser[] }>('/users/me/blocked');
      setUsers(data.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load blocked accounts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function unblock(account: PublicUser) {
    try {
      await api(`/users/${account.id}/block`, { method: 'DELETE' });
      setUsers((cur) => cur.filter((u) => u.id !== account.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not unblock');
    }
  }

  if (loading) return <p className="text-sm text-[var(--muted)]">Loading…</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (users.length === 0) return <p className="text-sm text-[var(--muted)]">No blocked accounts.</p>;

  return (
    <ul className="divide-y divide-[var(--line)]">
      {users.map((account) => (
        <li key={account.id} className="flex items-center gap-3 py-3">
          <Avatar name={account.displayName} src={account.avatarUrl} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{account.displayName}</p>
            <p className="truncate text-xs text-[var(--muted)]">@{account.handle}</p>
          </div>
          <button
            type="button"
            className="min-h-10 rounded-full border border-[var(--line)] px-3 text-sm font-semibold"
            onClick={() => void unblock(account)}
          >
            Unblock
          </button>
        </li>
      ))}
    </ul>
  );
}

function PhoneLinkPanel({
  phoneLink,
  phoneBusy,
  onMakePhoneLink,
}: {
  phoneLink: string | null;
  phoneBusy: boolean;
  onMakePhoneLink: () => void;
}) {
  return (
    <>
      <p className="text-sm text-[var(--muted)]">One-time link to sign in on another device. Expires in 5 minutes.</p>
      <button
        type="button"
        className="mt-3 flex min-h-11 items-center rounded-full border border-[var(--line)] px-5 text-sm font-semibold"
        onClick={onMakePhoneLink}
        disabled={phoneBusy}
      >
        {phoneBusy ? 'Making link…' : 'Create phone link'}
      </button>
      {phoneLink ? (
        <p className="mt-3 break-all rounded-xl bg-[var(--bg)] px-3 py-2 text-sm">
          <a className="text-accent underline" href={phoneLink}>
            {phoneLink}
          </a>
        </p>
      ) : null}
    </>
  );
}

function DeleteAccountPanel({
  deleteConfirm,
  setDeleteConfirm,
  deleteBusy,
  deleteError,
  onDeleteAccount,
}: {
  deleteConfirm: string;
  setDeleteConfirm: (v: string) => void;
  deleteBusy: boolean;
  deleteError: string | null;
  onDeleteAccount: () => void;
}) {
  return (
    <>
      <p className="text-sm text-[var(--muted)]">All credentials will be lost permanently. Type DELETE to confirm.</p>
      <input
        className="mt-3 w-full min-h-11 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 text-base"
        value={deleteConfirm}
        onChange={(e) => setDeleteConfirm(e.target.value)}
        placeholder="DELETE"
        autoComplete="off"
      />
      {deleteError ? <p className="mt-2 text-sm text-red-600">{deleteError}</p> : null}
      <button
        type="button"
        className="mt-3 flex min-h-11 items-center rounded-full border border-red-200 px-5 text-sm font-semibold text-red-600 disabled:opacity-60"
        disabled={deleteBusy || deleteConfirm !== 'DELETE'}
        onClick={onDeleteAccount}
      >
        {deleteBusy ? 'Deleting…' : 'Delete my account'}
      </button>
    </>
  );
}

export function planStatusLabel(tier: PlanTier | null) {
  if (!tier) return null;
  return PLAN_DEFINITIONS[tier].title;
}
