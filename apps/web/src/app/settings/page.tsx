'use client';

import { SettingsForm } from '@/components/SettingsForm';
import { useRequireAuth } from '@/lib/auth';

export default function SettingsPage() {
  useRequireAuth();
  return <SettingsForm />;
}
