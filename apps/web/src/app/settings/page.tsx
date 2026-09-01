'use client';

import { SettingsForm } from '@/components/SettingsForm';
import { useRequireAuth } from '@/lib/auth';

export default function SettingsPage() {
  const { user, loading } = useRequireAuth();
  if (loading || !user) {
    return <p className="p-6 text-sm text-[var(--muted)]">Checking your session.</p>;
  }
  return <SettingsForm />;
}
