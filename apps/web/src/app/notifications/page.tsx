'use client';

import { DropsList } from '@/components/DropsList';

export default function NotificationsPage() {
  return (
    <div>
      <h1 className="border-b border-[var(--line)] px-4 py-3 text-lg font-bold">Drops</h1>
      <DropsList />
    </div>
  );
}
