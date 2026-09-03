import type { MeUser, ReportSubmission } from '@voiceout/shared';

export function hasUnreadNotifications(count: number): boolean {
  return Number.isFinite(count) && count > 0;
}

export function notificationReadPayload(ids?: string[]) {
  const unique = [...new Set((ids ?? []).filter(Boolean))];
  return unique.length ? { ids: unique } : { all: true as const };
}

export function canViewModeration(role: MeUser['role']): boolean {
  return role === 'moderator' || role === 'admin';
}

export function buildReportPayload(
  targetType: ReportSubmission['targetType'],
  targetId: string,
  reason: ReportSubmission['reason'],
  details: string,
  alsoBlock?: boolean,
): ReportSubmission {
  const cleanDetails = details.trim();
  return {
    targetType,
    targetId,
    reason,
    ...(cleanDetails ? { details: cleanDetails } : {}),
    ...(alsoBlock ? { alsoBlock: true } : {}),
  };
}

export function restoreRemovedPosts<T extends { id: string }>(
  current: T[],
  removed: Array<{ post: T; index: number }>,
): T[] {
  const restored = [...current];
  for (const { post, index } of [...removed].sort((a, b) => a.index - b.index)) {
    if (!restored.some((item) => item.id === post.id)) restored.splice(Math.min(index, restored.length), 0, post);
  }
  return restored;
}
