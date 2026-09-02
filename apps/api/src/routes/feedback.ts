import type { FastifyInstance } from 'fastify';
import { bugFeedback, mediaObjects } from '@voiceout/db';
import { and, eq } from 'drizzle-orm';
import { bugFeedbackSchema } from '@voiceout/shared';
import { requireAuth, requireCsrf } from '../plugins/auth.js';

export async function feedbackRoutes(app: FastifyInstance) {
  app.post('/bug-feedback', async (req, reply) => {
    requireAuth(req, reply);
    requireCsrf(req);
    const body = bugFeedbackSchema.parse(req.body);
    if (body.screenshotMediaId) {
      const [image] = await app.db
        .select({ id: mediaObjects.id })
        .from(mediaObjects)
        .where(
          and(
            eq(mediaObjects.id, body.screenshotMediaId),
            eq(mediaObjects.userId, req.authUser!.id),
            eq(mediaObjects.kind, 'post_image'),
            eq(mediaObjects.status, 'ready'),
          ),
        )
        .limit(1);
      if (!image) return reply.code(400).send({ error: 'Screenshot must be your ready image upload' });
    }
    const [created] = await app.db
      .insert(bugFeedback)
      .values({
        userId: req.authUser!.id,
        description: body.description,
        screenshotMediaId: body.screenshotMediaId ?? null,
      })
      .returning({ id: bugFeedback.id, status: bugFeedback.status });
    return reply.code(201).send(created);
  });
}
