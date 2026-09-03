'use client';

import type { PlanBadge, PublicUser } from '@voiceout/shared';
import { BadgeCheck } from 'lucide-react';

export function DisplayName({
  name,
  planBadge,
  nameAccent = false,
  className = '',
}: {
  name: string;
  planBadge?: PlanBadge;
  nameAccent?: boolean;
  className?: string;
}) {
  const accent = nameAccent ? 'text-amber-500' : '';
  return (
    <span className={`inline-flex max-w-full items-center gap-1 ${className}`}>
      <span className={`truncate ${accent}`}>{name}</span>
      {planBadge ? (
        <BadgeCheck
          aria-label={planBadge === 'gold' ? 'Gold member' : 'Verified member'}
          className={`h-4 w-4 shrink-0 ${planBadge === 'gold' ? 'text-amber-500' : 'text-sky-500'}`}
        />
      ) : null}
    </span>
  );
}

export function userDisplayProps(user: Pick<PublicUser, 'displayName' | 'planBadge' | 'nameAccent'>) {
  return {
    name: user.displayName,
    planBadge: user.planBadge,
    nameAccent: user.nameAccent,
  };
}
