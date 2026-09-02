'use client';

import type {
  BugFeedbackResult,
  BugFeedbackSubmission,
  MeUser,
  ModerationBugFeedback,
  ModerationQueue,
  ModerationReport,
  ModerationStatus,
  PublicUser,
} from '@voiceout/shared';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, uploadPostImage } from '@/lib/api';
import { Avatar } from './Avatar';

type AccountListKind = 'blocked' | 'muted';

export function SafetySettings({ user: _user }: { user: MeUser }) {
  return (
    <>
      <BugReportForm />
      <AccountManagement />
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 space-y-3 border-t border-[var(--line)] pt-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function BugReportForm() {
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
      await api<BugFeedbackResult>('/bug-feedback', {
        method: 'POST',
        body: JSON.stringify({
          description: description.trim(),
          screenshotMediaId,
        } satisfies BugFeedbackSubmission),
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
    <Section title="Report a bug">
      <p className="text-sm text-[var(--muted)]">Tell us what went wrong. Safety reports belong on the post, comment, or profile itself.</p>
      <form className="space-y-3" onSubmit={(event) => void submit(event)}>
        <label className="block text-sm font-medium">
          What happened?
          <textarea required maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1 min-h-28 w-full rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3 text-base font-normal" />
          <span className="mt-1 block text-right text-xs text-[var(--muted)]">{description.length}/1000</span>
        </label>
        <label className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-[var(--line)] px-4 text-sm font-semibold">
          Add screenshot (optional)
          <input
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              if (file && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
                setError('Choose a JPEG, PNG, or WebP image');
                return;
              }
              setError(null);
              setScreenshot(file);
            }}
          />
        </label>
        {preview ? (
          <div className="relative w-fit">
            <img src={preview} alt="Screenshot preview" className="max-h-48 rounded-xl border border-[var(--line)] object-contain" />
            <button type="button" className="mt-2 block min-h-9 text-sm font-semibold text-red-600" onClick={() => setScreenshot(null)}>Remove screenshot</button>
          </div>
        ) : null}
        {stage === 'uploading' || stage === 'sending' ? <p role="status" className="text-sm text-[var(--muted)]">{stage === 'uploading' ? 'Uploading screenshot…' : 'Sending feedback…'}</p> : null}
        {stage === 'sent' ? <p role="status" className="text-sm font-semibold text-green-700">Bug report sent. Thank you.</p> : null}
        {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
        <button type="submit" disabled={!description.trim() || stage === 'uploading' || stage === 'sending'} className="min-h-11 rounded-full bg-accent px-5 text-sm font-semibold text-white disabled:opacity-50">Send bug report</button>
      </form>
    </Section>
  );
}

function AccountManagement() {
  const [kind, setKind] = useState<AccountListKind>('blocked');
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ users: PublicUser[] }>(`/users/me/${kind}`);
      setUsers(data.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not load ${kind} accounts`);
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(account: PublicUser) {
    try {
      await api(`/users/${account.id}/${kind === 'blocked' ? 'block' : 'mute'}`, { method: 'DELETE' });
      setUsers((current) => current.filter((item) => item.id !== account.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update account');
    }
  }

  return (
    <Section title="Blocked and muted accounts">
      <div className="flex gap-2" role="tablist" aria-label="Account safety lists">
        {(['blocked', 'muted'] as const).map((value) => (
          <button key={value} type="button" role="tab" aria-selected={kind === value} onClick={() => setKind(value)} className={`min-h-10 rounded-full px-4 text-sm font-semibold ${kind === value ? 'bg-accent text-white' : 'bg-[var(--bg)]'}`}>
            {value === 'blocked' ? 'Blocked' : 'Muted'}
          </button>
        ))}
      </div>
      {loading ? <p role="status" className="text-sm text-[var(--muted)]">Loading {kind} accounts…</p> : null}
      {error ? <div><p role="alert" className="text-sm text-red-600">{error}</p><button type="button" className="mt-2 text-sm font-semibold text-accent" onClick={() => void load()}>Try again</button></div> : null}
      {!loading && !error && users.length === 0 ? <p className="text-sm text-[var(--muted)]">You have no {kind} accounts.</p> : null}
      <ul className="divide-y divide-[var(--line)]">
        {users.map((account) => (
          <li key={account.id} className="flex items-center gap-3 py-3">
            <Avatar name={account.displayName} src={account.avatarUrl} size="sm" />
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{account.displayName}</p><p className="truncate text-xs text-[var(--muted)]">@{account.handle}</p></div>
            <button type="button" className="min-h-10 rounded-full border border-[var(--line)] px-3 text-sm font-semibold" onClick={() => void remove(account)}>{kind === 'blocked' ? 'Unblock' : 'Unmute'}</button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function ModeratorPanel({
  role,
  unlocked = true,
  onNeedUnlock,
}: {
  role: 'moderator' | 'admin';
  unlocked?: boolean;
  onNeedUnlock?: () => void;
}) {
  const [queue, setQueue] = useState<'reports' | 'bug-feedback'>('reports');
  const [status, setStatus] = useState<ModerationStatus>('pending');
  const [items, setItems] = useState<Array<ModerationReport | ModerationBugFeedback>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<ModerationQueue<ModerationReport | ModerationBugFeedback>>(
        `/admin/${queue}?status=${status}&limit=50`,
      );
      setItems(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load moderation queue');
    } finally {
      setLoading(false);
    }
  }, [queue, status]);

  useEffect(() => {
    void load();
  }, [load]);

  function needUnlockMessage(err: unknown) {
    if (err && typeof err === 'object' && 'extra' in err) {
      const extra = (err as { extra?: { code?: string } }).extra;
      if (extra?.code === 'ADMIN_STEPUP_REQUIRED') {
        onNeedUnlock?.();
        return 'Unlock the panel first (confirm identity).';
      }
    }
    return err instanceof Error ? err.message : 'Request failed';
  }

  async function resolve(id: string, action: 'resolved' | 'dismissed') {
    try {
      await api(`/admin/${queue}/${id}/resolve`, { method: 'POST', body: JSON.stringify({ action }) });
      await load();
    } catch (err) {
      setError(needUnlockMessage(err));
    }
  }

  async function removeComment(id: string) {
    if (!unlocked) {
      setError('Unlock the panel first (confirm identity).');
      onNeedUnlock?.();
      return;
    }
    if (!window.confirm('Remove this reported comment?')) return;
    try {
      await api(`/admin/comments/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(needUnlockMessage(err));
    }
  }

  async function setPostStatus(postId: string, next: 'published' | 'rejected') {
    if (!unlocked) {
      setError('Unlock the panel first (confirm identity).');
      onNeedUnlock?.();
      return;
    }
    try {
      await api(`/admin/posts/${postId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: next }),
      });
      await load();
    } catch (err) {
      setError(needUnlockMessage(err));
    }
  }

  async function suspend(userId: string) {
    if (!unlocked) {
      setError('Unlock the panel first (confirm identity).');
      onNeedUnlock?.();
      return;
    }
    const reason = window.prompt('Reason for suspension (required)');
    if (!reason?.trim()) return;
    try {
      await api(`/admin/users/${userId}/suspend`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() }),
      });
    } catch (err) {
      setError(needUnlockMessage(err));
    }
  }

  async function unsuspend(userId: string) {
    if (!unlocked) {
      setError('Unlock the panel first (confirm identity).');
      onNeedUnlock?.();
      return;
    }
    if (!window.confirm('Unsuspend this account?')) return;
    try {
      await api(`/admin/users/${userId}/unsuspend`, { method: 'POST', body: '{}' });
    } catch (err) {
      setError(needUnlockMessage(err));
    }
  }

  return (
    <Section title="Moderator panel">
      <p className="text-sm text-[var(--muted)]">
        Reports and bugs load without unlock. Suspend, remove, and reject need identity confirmation.
      </p>
      <div className="flex flex-wrap gap-2">
        <select
          aria-label="Queue"
          value={queue}
          onChange={(event) => setQueue(event.target.value as typeof queue)}
          className="min-h-11 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3"
        >
          <option value="reports">Safety reports</option>
          <option value="bug-feedback">Bug feedback</option>
        </select>
        <select
          aria-label="Status"
          value={status}
          onChange={(event) => setStatus(event.target.value as ModerationStatus)}
          className="min-h-11 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3"
        >
          <option value="pending">Pending</option>
          <option value="resolved">Resolved</option>
          <option value="dismissed">Dismissed</option>
        </select>
      </div>
      {loading ? (
        <p role="status" className="text-sm text-[var(--muted)]">
          Loading moderation queue…
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
      {!loading && !error && items.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No items in this queue.</p>
      ) : null}
      <ul className="space-y-3">
        {items.map((item) => {
          const report = 'targetType' in item ? item : null;
          return (
            <li key={item.id} className="rounded-2xl border border-[var(--line)] bg-[var(--bg)] p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                {report ? `${report.targetType} · ${report.reason}` : 'Bug feedback'} · {item.status}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm">
                {report
                  ? report.details || 'No additional details.'
                  : 'description' in item
                    ? item.description
                    : ''}
              </p>
              {report ? (
                <p className="mt-1 break-all text-xs text-[var(--muted)]">Target id: {report.targetId}</p>
              ) : null}
              {status === 'pending' ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="min-h-10 rounded-full bg-accent px-3 text-sm font-semibold text-white"
                    onClick={() => void resolve(item.id, 'resolved')}
                  >
                    Resolve
                  </button>
                  <button
                    type="button"
                    className="min-h-10 rounded-full border border-[var(--line)] px-3 text-sm font-semibold"
                    onClick={() => void resolve(item.id, 'dismissed')}
                  >
                    Dismiss
                  </button>
                  {report?.targetType === 'comment' ? (
                    <button
                      type="button"
                      className="min-h-10 rounded-full border border-red-200 px-3 text-sm font-semibold text-red-600"
                      onClick={() => void removeComment(report.targetId)}
                    >
                      Remove comment
                    </button>
                  ) : null}
                  {report?.targetType === 'post' ? (
                    <>
                      <button
                        type="button"
                        className="min-h-10 rounded-full border border-red-200 px-3 text-sm font-semibold text-red-600"
                        onClick={() => void setPostStatus(report.targetId, 'rejected')}
                      >
                        Reject post
                      </button>
                      <button
                        type="button"
                        className="min-h-10 rounded-full border border-[var(--line)] px-3 text-sm font-semibold"
                        onClick={() => void setPostStatus(report.targetId, 'published')}
                      >
                        Restore post
                      </button>
                    </>
                  ) : null}
                  {role === 'admin' && report?.subjectUserId ? (
                    <>
                      <button
                        type="button"
                        className="min-h-10 rounded-full border border-red-200 px-3 text-sm font-semibold text-red-600"
                        onClick={() => void suspend(report.subjectUserId!)}
                      >
                        Suspend account
                      </button>
                      <button
                        type="button"
                        className="min-h-10 rounded-full border border-[var(--line)] px-3 text-sm font-semibold"
                        onClick={() => void unsuspend(report.subjectUserId!)}
                      >
                        Unsuspend account
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
