import type { FastifyInstance } from 'fastify';
import { posts, reports } from '@voiceout/db';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { writeAudit } from '../lib/audit.js';
import { requireAdmin, requireCsrf } from '../plugins/auth.js';

export async function adminRoutes(app: FastifyInstance) {
  app.get('/admin/reports', async (req) => {
    await requireAdmin(app, req);
    const rows = await app.db.select().from(reports).orderBy(desc(reports.createdAt)).limit(100);
    await writeAudit(app.db, req, 'admin_reports');
    return { reports: rows };
  });

  app.post('/admin/posts/:id/status', async (req) => {
    await requireAdmin(app, req);
    if (req.authUser) requireCsrf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ status: z.enum(['published', 'rejected']) }).parse(req.body);
    await app.db.update(posts).set({ status: body.status }).where(eq(posts.id, id));
    await writeAudit(app.db, req, `admin_post_${body.status}`);
    return { ok: true };
  });
}
