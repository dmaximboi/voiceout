'use client';

import { useEffect } from 'react';
import { notFound } from 'next/navigation';
import { useRequireAuth } from '@/lib/auth';
import { canViewModeration } from '@/lib/safetyState';
import { AdminConsole } from '@/components/AdminConsole';

export default function AdminPage() {
  const { user, loading } = useRequireAuth();

  useEffect(() => {
    if (loading) return;
    if (!user || !canViewModeration(user.role)) notFound();
  }, [loading, user]);

  if (loading || !user) {
    return <p className="p-6 text-sm text-[var(--muted)]">Checking your session.</p>;
  }
  if (!canViewModeration(user.role)) return null;

  return <AdminConsole />;
}
