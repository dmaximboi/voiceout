import {
  blocks,
  comments,
  notifications,
  posts,
  reports,
  sessions,
  users,
  type Db,
} from '@voiceout/db';
import { and, countDistinct, eq, isNull, sql } from 'drizzle-orm';
import type { ReportSubmission } from '@voiceout/shared';
import { httpError } from './http.js';

export type ResolvedReportTarget = {
  targetType: ReportSubmission['targetType'];
  targetId: string;
  subjectUserId: string;
};

export function moderationThreshold(uniqueReporters: number) {
  return {
    warn: uniqueReporters >= 3,
    suspend: uniqueReporters >= 5,
  };
}

export function canAutoModerateRole(role: 'user' | 'moderator' | 'admin') {
  return role === 'user';
}

export async function resolveReportTarget(
  db: Pick<Db, 'select'>,
  targetType: ReportSubmission['targetType'],
  targetId: string,
): Promise<ResolvedReportTarget | null> {
  if (targetType === 'user') {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, targetId), isNull(users.deletedAt)))
      .limit(1);
    return user ? { targetType, targetId, subjectUserId: user.id } : null;
  }
  if (targetType === 'post') {
    const [post] = await db
      .select({ authorId: posts.authorId })
      .from(posts)
      .where(and(eq(posts.id, targetId), eq(posts.status, 'published')))
      .limit(1);
    return post ? { targetType, targetId, subjectUserId: post.authorId } : null;
  }
  const [comment] = await db
    .select({ authorId: comments.authorId })
    .from(comments)
    .innerJoin(posts, eq(posts.id, comments.postId))
    .where(and(eq(comments.id, targetId), eq(posts.status, 'published')))
    .limit(1);
  return comment ? { targetType, targetId, subjectUserId: comment.authorId } : null;
}

export async function submitReport(db: Db, reporterId: string, body: ReportSubmission) {
  return db.transaction(async (tx) => {
    const target = await resolveReportTarget(tx, body.targetType, body.targetId);
    if (!target) throw httpError(404, 'Report target not found');
    if (target.subjectUserId === reporterId) throw httpError(400, 'You cannot report yourself');

    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${target.subjectUserId}))`);
    const [inserted] = await tx
      .insert(reports)
      .values({
        reporterId,
        targetType: target.targetType,
        targetId: target.targetId,
        subjectUserId: target.subjectUserId,
        reason: body.reason,
        details: body.details ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: reports.id });
    if (!inserted) return { accepted: true, duplicate: true };

    if (body.alsoBlock) {
      await tx
        .insert(blocks)
        .values({ blockerId: reporterId, blockedId: target.subjectUserId })
        .onConflictDoNothing();
    }

    const [aggregate] = await tx
      .select({ value: countDistinct(reports.reporterId) })
      .from(reports)
      .where(and(eq(reports.subjectUserId, target.subjectUserId), eq(reports.status, 'pending')));
    const uniqueReporters = Number(aggregate?.value ?? 0);
    const threshold = moderationThreshold(uniqueReporters);
    const [subject] = await tx
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, target.subjectUserId))
      .limit(1);
    if (!subject || !canAutoModerateRole(subject.role)) {
      return { accepted: true, duplicate: false };
    }

    if (threshold.warn) {
      const [warned] = await tx
        .update(users)
        .set({ warningCount: sql`${users.warningCount} + 1`, warnedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(users.id, target.subjectUserId), isNull(users.warnedAt)))
        .returning({ id: users.id });
      if (warned) {
        await tx.insert(notifications).values({
          userId: target.subjectUserId,
          actorId: target.subjectUserId,
          type: 'account_warning',
          message: 'Your account has received a moderation warning. Two more unique reports may suspend it.',
        });
      }
    }

    if (threshold.suspend) {
      const [suspended] = await tx
        .update(users)
        .set({
          suspendedAt: new Date(),
          suspensionReason: 'Automatically suspended after five unique pending reporters',
          updatedAt: new Date(),
        })
        .where(and(eq(users.id, target.subjectUserId), isNull(users.suspendedAt)))
        .returning({ id: users.id });
      if (suspended) await tx.delete(sessions).where(eq(sessions.userId, target.subjectUserId));
    }
    return { accepted: true, duplicate: false };
  });
}
