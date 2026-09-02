import type { FastifyInstance } from 'fastify';
import { bugFeedback, comments, posts, reports, sessions, users } from '@voiceout/db';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  moderationQueueQuerySchema,
  moderationResolutionSchema,
  suspensionSchema,
} from '@voiceout/shared';
import { writeAudit } from '../lib/audit.js';
import { requireAdmin, requireAdministrator, requireAdminStepUp, requireCsrf } from '../plugins/auth.js';

export async function adminRoutes(app: FastifyInstance) {
  app.get('/admin/reports', async (req) => {
    await requireAdmin(app, req);
    const query = moderationQueueQuerySchema.parse(req.query);
    const rows = await app.db
      .select({
        id: reports.id,
        targetType: reports.targetType,
        targetId: reports.targetId,
        subjectUserId: reports.subjectUserId,
        reason: reports.reason,
        details: reports.details,
        status: reports.status,
        resolvedAt: reports.resolvedAt,
        resolutionNote: reports.resolutionNote,
        createdAt: reports.createdAt,
      })
      .from(reports)
      .where(eq(reports.status, query.status))
      .orderBy(desc(reports.createdAt))
      .limit(query.limit)
      .offset((query.page - 1) * query.limit);
    await writeAudit(app.db, req, 'admin_reports');
    return { items: rows, page: query.page, limit: query.limit };
  });

  app.post('/admin/reports/:id/resolve', async (req, reply) => {
    await requireAdmin(app, req);
    requireCsrf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = moderationResolutionSchema.parse(req.body);
    const [row] = await app.db
      .update(reports)
      .set({
        status: body.action,
        resolutionNote: body.note ?? null,
        resolvedBy: req.authUser!.id,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(reports.id, id))
      .returning({ id: reports.id });
    if (!row) return reply.code(404).send({ error: 'Not found' });
    await writeAudit(app.db, req, `report_${body.action}`, req.authUser!.id, { reportId: id });
    return { ok: true };
  });

  app.get('/admin/bug-feedback', async (req) => {
    await requireAdmin(app, req);
    const query = moderationQueueQuerySchema.parse(req.query);
    const rows = await app.db
      .select({
        id: bugFeedback.id,
        description: bugFeedback.description,
        screenshotMediaId: bugFeedback.screenshotMediaId,
        status: bugFeedback.status,
        resolvedAt: bugFeedback.resolvedAt,
        resolutionNote: bugFeedback.resolutionNote,
        createdAt: bugFeedback.createdAt,
      })
      .from(bugFeedback)
      .where(eq(bugFeedback.status, query.status))
      .orderBy(desc(bugFeedback.createdAt))
      .limit(query.limit)
      .offset((query.page - 1) * query.limit);
    await writeAudit(app.db, req, 'admin_bug_feedback');
    return { items: rows, page: query.page, limit: query.limit };
  });

  app.post('/admin/bug-feedback/:id/resolve', async (req, reply) => {
    await requireAdmin(app, req);
    requireCsrf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = moderationResolutionSchema.parse(req.body);
    const [row] = await app.db
      .update(bugFeedback)
      .set({
        status: body.action,
        resolutionNote: body.note ?? null,
        resolvedBy: req.authUser!.id,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(bugFeedback.id, id))
      .returning({ id: bugFeedback.id });
    if (!row) return reply.code(404).send({ error: 'Not found' });
    await writeAudit(app.db, req, `bug_feedback_${body.action}`, req.authUser!.id, { feedbackId: id });
    return { ok: true };
  });

  app.post('/admin/users/:id/suspend', async (req, reply) => {
    await requireAdministrator(app, req);
    await requireAdminStepUp(app, req);
    requireCsrf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = suspensionSchema.parse(req.body);
    const [target] = await app.db.select({ role: users.role }).from(users).where(eq(users.id, id)).limit(1);
    if (!target) return reply.code(404).send({ error: 'Not found' });
    if (target.role === 'admin') return reply.code(403).send({ error: 'Administrators cannot be suspended here' });
    await app.db.transaction(async (tx) => {
      await tx.update(users).set({
        suspendedAt: new Date(),
        suspensionReason: body.reason,
        suspendedBy: req.authUser!.id,
        updatedAt: new Date(),
      }).where(eq(users.id, id));
      await tx.delete(sessions).where(eq(sessions.userId, id));
    });
    await writeAudit(app.db, req, 'user_suspended', req.authUser!.id, { targetUserId: id });
    return { ok: true };
  });

  app.post('/admin/users/:id/unsuspend', async (req, reply) => {
    await requireAdministrator(app, req);
    await requireAdminStepUp(app, req);
    requireCsrf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [target] = await app.db.select({ role: users.role }).from(users).where(eq(users.id, id)).limit(1);
    if (!target) return reply.code(404).send({ error: 'Not found' });
    if (target.role === 'admin') return reply.code(403).send({ error: 'Administrators cannot be changed here' });
    await app.db.update(users).set({
      suspendedAt: null,
      suspensionReason: null,
      suspendedBy: null,
      updatedAt: new Date(),
    }).where(eq(users.id, id));
    await writeAudit(app.db, req, 'user_unsuspended', req.authUser!.id, { targetUserId: id });
    return { ok: true };
  });

  app.delete('/admin/comments/:id', async (req, reply) => {
    await requireAdmin(app, req);
    await requireAdminStepUp(app, req);
    requireCsrf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [deleted] = await app.db.delete(comments).where(eq(comments.id, id)).returning({ id: comments.id });
    if (!deleted) return reply.code(404).send({ error: 'Not found' });
    await writeAudit(app.db, req, 'comment_removed', req.authUser!.id, { commentId: id });
    return { ok: true };
  });

  app.post('/admin/posts/:id/status', async (req) => {
    await requireAdmin(app, req);
    await requireAdminStepUp(app, req);
    requireCsrf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ status: z.enum(['published', 'rejected']) }).parse(req.body);
    await app.db.update(posts).set({ status: body.status }).where(eq(posts.id, id));
    await writeAudit(app.db, req, `admin_post_${body.status}`);
    return { ok: true };
  });

  app.post('/admin/users/:id/studio', async (req, reply) => {
    await requireAdministrator(app, req);
    await requireAdminStepUp(app, req);
    requireCsrf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ days: z.number().int().min(1).max(366) }).parse(req.body);
    const [target] = await app.db
      .select({ id: users.id, studioUntil: users.studioUntil })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (!target) return reply.code(404).send({ error: 'Not found' });
    const base = target.studioUntil && target.studioUntil.getTime() > Date.now() ? target.studioUntil.getTime() : Date.now();
    const until = new Date(base + body.days * 24 * 60 * 60 * 1000);
    await app.db.update(users).set({ studioUntil: until, updatedAt: new Date() }).where(eq(users.id, id));
    await writeAudit(app.db, req, 'studio_granted', req.authUser!.id, { targetUserId: id, days: body.days });
    return { ok: true, studioUntil: until.toISOString() };
  });

  app.post('/admin/users/:id/studio/revoke', async (req, reply) => {
    await requireAdministrator(app, req);
    await requireAdminStepUp(app, req);
    requireCsrf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [target] = await app.db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
    if (!target) return reply.code(404).send({ error: 'Not found' });
    await app.db.update(users).set({ studioUntil: null, updatedAt: new Date() }).where(eq(users.id, id));
    await writeAudit(app.db, req, 'studio_revoked', req.authUser!.id, { targetUserId: id });
    return { ok: true };
  });
}
