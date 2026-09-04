'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { PLAN_TIERS, type PlanTier } from '@voiceout/shared';
import { api, ApiError } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';
import { AdminStepUp, useAdminStepUpStatus } from '@/components/AdminStepUp';

type Tab = 'users' | 'reports' | 'plans' | 'audit';

type AdminUser = {
  id: string;
  handle: string;
  displayName: string;
  email: string;
  role: string;
  warningCount: number;
  suspendedAt: string | null;
  suspensionReason: string | null;
  planTier: string | null;
  studioUntil: string | null;
  createdAt: string;
};

type ReportRow = {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  details: string | null;
  status: string;
  createdAt: string;
};

type AuditRow = {
  id: string;
  handle: string | null;
  action: string;
  meta: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
};

export function AdminConsole() {
  const { user, loading } = useRequireAuth();
  const step = useAdminStepUpStatus();
  const [tab, setTab] = useState<Tab>('users');

  if (loading || !user) {
    return <p className="p-6 text-sm text-[var(--muted)]">Checking your session.</p>;
  }

  return (
    <div className="px-4 py-6 pb-28">
      <h1 className="text-xl font-bold">Admin</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Search users, work the report queue, grant plans, and review the audit log.
      </p>

      <div className="mt-5">
        <AdminStepUp
          user={user}
          unlocked={step.unlocked}
          onUnlocked={(sec) => step.markUnlocked(sec)}
        />
      </div>

      <div className="mt-5 flex gap-1 overflow-x-auto border-b border-[var(--line)]">
        {(
          [
            ['users', 'Users'],
            ['reports', 'Reports'],
            ['plans', 'Plans'],
            ['audit', 'Audit'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`min-h-11 shrink-0 px-3 text-sm font-semibold ${
              tab === id ? 'border-b-2 border-accent text-accent' : 'text-[var(--muted)]'
            }`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'users' ? (
        <UsersPanel unlocked={step.unlocked} isAdmin={user.role === 'admin'} onNeedUnlock={() => void step.refresh()} />
      ) : null}
      {tab === 'reports' ? <ReportsPanel unlocked={step.unlocked} onNeedUnlock={() => void step.refresh()} /> : null}
      {tab === 'plans' ? (
        <PlansPanel unlocked={step.unlocked} isAdmin={user.role === 'admin'} onNeedUnlock={() => void step.refresh()} />
      ) : null}
      {tab === 'audit' ? (
        user.role === 'admin' ? (
          <AuditPanel />
        ) : (
          <p className="mt-4 text-sm text-[var(--muted)]">Audit log is admin only.</p>
        )
      ) : null}
    </div>
  );
}

function UsersPanel({
  unlocked,
  isAdmin,
  onNeedUnlock,
}: {
  unlocked: boolean;
  isAdmin: boolean;
  onNeedUnlock: () => void;
}) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<AdminUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function search(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const data = await api<{ users: AdminUser[] }>(
        `/admin/users/search?q=${encodeURIComponent(q.trim())}`,
      );
      setRows(data.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setBusy(false);
    }
  }

  async function act(path: string, body?: unknown) {
    setError(null);
    setNote(null);
    if (!unlocked) {
      setError('Unlock the panel first.');
      onNeedUnlock();
      return;
    }
    try {
      await api(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
      setNote('Done.');
      if (q.trim()) {
        const data = await api<{ users: AdminUser[] }>(
          `/admin/users/search?q=${encodeURIComponent(q.trim())}`,
        );
        setRows(data.users);
      }
    } catch (err) {
      const msg = err instanceof ApiError || err instanceof Error ? err.message : 'Action failed';
      setError(msg);
      if (err instanceof ApiError && err.extra.code === 'ADMIN_STEPUP_REQUIRED') onNeedUnlock();
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <form onSubmit={(e) => void search(e)} className="flex gap-2">
        <input
          className="min-h-11 flex-1 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3"
          placeholder="Handle, name, or email"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit" disabled={busy || !q.trim()} className="min-h-11 rounded-full bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50">
          Search
        </button>
      </form>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {note ? <p className="text-sm text-[var(--muted)]">{note}</p> : null}
      <ul className="space-y-3">
        {rows.map((u) => (
          <li key={u.id} className="rounded-2xl border border-[var(--line)] p-3">
            <p className="font-semibold">
              {u.displayName} <span className="text-[var(--muted)]">@{u.handle}</span>
            </p>
            <p className="text-xs text-[var(--muted)]">
              {u.email} · warnings {u.warningCount}
              {u.suspendedAt ? ' · suspended' : ''}
              {u.planTier ? ` · ${u.planTier}` : ''}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="min-h-10 rounded-full border border-[var(--line)] px-3 text-sm font-semibold"
                onClick={() => void act(`/admin/users/${u.id}/warn`, { message: 'Please follow VoiceOut community guidelines.' })}
              >
                Warn
              </button>
              {isAdmin ? (
                <>
                  {u.suspendedAt ? (
                    <button
                      type="button"
                      className="min-h-10 rounded-full border border-[var(--line)] px-3 text-sm font-semibold"
                      onClick={() => void act(`/admin/users/${u.id}/unsuspend`)}
                    >
                      Unsuspend
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="min-h-10 rounded-full border border-red-200 px-3 text-sm font-semibold text-red-600"
                      onClick={() =>
                        void act(`/admin/users/${u.id}/suspend`, { reason: 'Manual suspension from admin panel' })
                      }
                    >
                      Suspend
                    </button>
                  )}
                </>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReportsPanel({ unlocked, onNeedUnlock }: { unlocked: boolean; onNeedUnlock: () => void }) {
  const [items, setItems] = useState<ReportRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api<{ items: ReportRow[] }>('/admin/reports?status=pending&limit=40');
      setItems(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load reports');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function resolve(id: string, action: 'resolved' | 'dismissed') {
    if (!unlocked) {
      setError('Unlock the panel first.');
      onNeedUnlock();
      return;
    }
    try {
      await api(`/admin/reports/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Could not resolve');
      if (err instanceof ApiError && err.extra.code === 'ADMIN_STEPUP_REQUIRED') onNeedUnlock();
    }
  }

  return (
    <div className="mt-4 space-y-3">
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {items.length === 0 ? <p className="text-sm text-[var(--muted)]">No pending reports.</p> : null}
      {items.map((r) => (
        <article key={r.id} className="rounded-2xl border border-[var(--line)] p-3">
          <p className="text-sm font-semibold">
            {r.targetType} · {r.reason}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">{new Date(r.createdAt).toLocaleString()}</p>
          {r.details ? <p className="mt-2 text-sm">{r.details}</p> : null}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="min-h-10 rounded-full bg-accent px-3 text-sm font-semibold text-white"
              onClick={() => void resolve(r.id, 'resolved')}
            >
              Resolve
            </button>
            <button
              type="button"
              className="min-h-10 rounded-full border border-[var(--line)] px-3 text-sm font-semibold"
              onClick={() => void resolve(r.id, 'dismissed')}
            >
              Dismiss
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function PlansPanel({
  unlocked,
  isAdmin,
  onNeedUnlock,
}: {
  unlocked: boolean;
  isAdmin: boolean;
  onNeedUnlock: () => void;
}) {
  const [handle, setHandle] = useState('');
  const [tier, setTier] = useState<PlanTier>('verified');
  const [days, setDays] = useState(30);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isAdmin) {
    return <p className="mt-4 text-sm text-[var(--muted)]">Plan grants are admin only.</p>;
  }

  async function grant(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (!unlocked) {
      setError('Unlock the panel first.');
      onNeedUnlock();
      return;
    }
    try {
      const found = await api<{ users: AdminUser[] }>(
        `/admin/users/search?q=${encodeURIComponent(handle.trim())}`,
      );
      const match =
        found.users.find((u) => u.handle === handle.trim().toLowerCase()) ?? found.users[0];
      if (!match) {
        setError('No user found');
        return;
      }
      await api(`/admin/users/${match.id}/plan`, {
        method: 'POST',
        body: JSON.stringify({ tier, days }),
      });
      setMessage(`Granted ${tier} to @${match.handle} for ${days} days`);
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Grant failed');
      if (err instanceof ApiError && err.extra.code === 'ADMIN_STEPUP_REQUIRED') onNeedUnlock();
    }
  }

  async function revoke() {
    setError(null);
    setMessage(null);
    if (!unlocked) {
      setError('Unlock the panel first.');
      onNeedUnlock();
      return;
    }
    try {
      const found = await api<{ users: AdminUser[] }>(
        `/admin/users/search?q=${encodeURIComponent(handle.trim())}`,
      );
      const match =
        found.users.find((u) => u.handle === handle.trim().toLowerCase()) ?? found.users[0];
      if (!match) {
        setError('No user found');
        return;
      }
      await api(`/admin/users/${match.id}/studio/revoke`, { method: 'POST', body: '{}' });
      setMessage(`Revoked plan for @${match.handle}`);
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Revoke failed');
      if (err instanceof ApiError && err.extra.code === 'ADMIN_STEPUP_REQUIRED') onNeedUnlock();
    }
  }

  return (
    <form onSubmit={(e) => void grant(e)} className="mt-4 space-y-3 rounded-2xl border border-[var(--line)] p-4">
      <input
        className="min-h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3"
        placeholder="Handle"
        value={handle}
        onChange={(e) => setHandle(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        {PLAN_TIERS.map((t) => (
          <button
            key={t}
            type="button"
            className={`min-h-10 rounded-full px-3 text-sm font-semibold ${
              tier === t ? 'bg-accent text-white' : 'border border-[var(--line)]'
            }`}
            onClick={() => setTier(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <label className="block text-sm">
        Days
        <input
          type="number"
          min={1}
          max={366}
          className="mt-1 min-h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3"
          value={days}
          onChange={(e) => setDays(Number(e.target.value) || 30)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="min-h-11 rounded-full bg-accent px-4 text-sm font-semibold text-white">
          Grant plan
        </button>
        <button
          type="button"
          className="min-h-11 rounded-full border border-[var(--line)] px-4 text-sm font-semibold"
          onClick={() => void revoke()}
        >
          Revoke
        </button>
      </div>
      {message ? <p className="text-sm text-[var(--muted)]">{message}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </form>
  );
}

function AuditPanel() {
  const [items, setItems] = useState<AuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ items: AuditRow[] }>('/admin/audit?limit=50')
      .then((data) => setItems(data.items))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load audit'));
  }, []);

  return (
    <div className="mt-4 space-y-2">
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {items.map((row) => (
        <div key={row.id} className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm">
          <p className="font-semibold">
            {row.action} {row.handle ? <span className="text-[var(--muted)]">@{row.handle}</span> : null}
          </p>
          <p className="text-xs text-[var(--muted)]">{new Date(row.createdAt).toLocaleString()}</p>
        </div>
      ))}
    </div>
  );
}
