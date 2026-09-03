import type { FastifyInstance, FastifyRequest } from 'fastify';
import { billingCheckouts, billingWebhookEvents, users } from '@voiceout/db';
import { and, desc, eq } from 'drizzle-orm';
import { STUDIO_PRICE_CENTS, STUDIO_PRICE_LABEL } from '@voiceout/shared';
import { requireAuth, requireCsrf } from '../plugins/auth.js';
import { writeAudit } from '../lib/audit.js';
import {
  bachsCheckoutPaid,
  bachsConfigured,
  createBachsCheckout,
  getBachsCheckout,
  verifyBachsSignature,
} from '../lib/bachs.js';
import { randomToken } from '../lib/crypto.js';
import { checkoutReturnOrigin } from '../lib/origins.js';
import { z } from 'zod';

const STUDIO_DAYS = 30;

async function grantStudio(
  app: FastifyInstance,
  req: FastifyRequest,
  userId: string,
  checkoutId?: string | null,
) {
  const [current] = await app.db
    .select({ studioUntil: users.studioUntil })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const base =
    current?.studioUntil && current.studioUntil.getTime() > Date.now()
      ? current.studioUntil.getTime()
      : Date.now();
  const until = new Date(base + STUDIO_DAYS * 24 * 60 * 60 * 1000);
  await app.db.update(users).set({ studioUntil: until, updatedAt: new Date() }).where(eq(users.id, userId));
  await writeAudit(app.db, req, 'studio_paid', userId, {
    checkoutId: checkoutId ?? null,
    until: until.toISOString(),
  });
  return until;
}

export async function billingRoutes(app: FastifyInstance) {
  app.get('/billing/studio', async (req, reply) => {
    requireAuth(req, reply);
    return {
      priceCents: STUDIO_PRICE_CENTS,
      priceLabel: STUDIO_PRICE_LABEL,
      isStudio: req.authUser!.isStudio,
      checkoutReady: bachsConfigured(app.env),
      webhookPath: '/billing/webhooks/bachs',
      webhookUrlHint: 'https://api.voiceout.xyz/billing/webhooks/bachs',
      webhookNeedsHttps: true,
    };
  });

  app.post(
    '/billing/studio/checkout',
    { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } },
    async (req, reply) => {
      requireAuth(req, reply);
      requireCsrf(req);
      if (!bachsConfigured(app.env)) {
        return reply.code(503).send({
          error: 'Payments are not configured yet',
          code: 'PAYMENTS_NOT_CONFIGURED',
        });
      }
      if (req.authUser!.isStudio) {
        return reply.code(409).send({ error: 'Voice studio is already active' });
      }
      const [account] = await app.db
        .select({ email: users.email, displayName: users.displayName })
        .from(users)
        .where(eq(users.id, req.authUser!.id))
        .limit(1);
      if (!account) return reply.code(404).send({ error: 'Not found' });
      const reference = `studio_${req.authUser!.id.slice(0, 8)}_${randomToken(8)}`;
      const origin = checkoutReturnOrigin(req, app.env);
      if (!origin.startsWith('https://') && app.env.NODE_ENV === 'production') {
        return reply.code(400).send({ error: 'Checkout requires an HTTPS site URL' });
      }
      let session: { checkoutId: string; checkoutUrl: string };
      try {
        session = await createBachsCheckout(app.env, {
          email: account.email,
          name: account.displayName,
          userId: req.authUser!.id,
          successUrl: `${origin}/settings?studio=ok`,
          cancelUrl: `${origin}/settings?studio=cancel`,
          reference,
        });
      } catch (err) {
        req.log.error({ err }, 'bachs checkout failed');
        return reply.code(502).send({
          error: err instanceof Error ? err.message : 'Could not start checkout',
        });
      }
      await app.db.insert(billingCheckouts).values({
        userId: req.authUser!.id,
        checkoutId: session.checkoutId,
        status: 'open',
        purpose: 'studio',
      });
      await writeAudit(app.db, req, 'studio_checkout_started', req.authUser!.id, {
        checkoutId: session.checkoutId,
      });
      return { checkoutUrl: session.checkoutUrl, checkoutId: session.checkoutId };
    },
  );

  /** After Bachs redirects back. Polls Bachs so localhost HTTP webhooks are not required. */
  app.post(
    '/billing/studio/confirm',
    { config: { rateLimit: { max: 40, timeWindow: '1 minute' } } },
    async (req, reply) => {
      requireAuth(req, reply);
      requireCsrf(req);
      if (!bachsConfigured(app.env)) {
        return reply.code(503).send({ error: 'Payments are not configured yet' });
      }
      const body = z
        .object({ checkoutId: z.string().trim().min(3).max(128).optional() })
        .parse(req.body ?? {});
      let checkoutId = body.checkoutId;
      if (!checkoutId) {
        const [latest] = await app.db
          .select({ checkoutId: billingCheckouts.checkoutId })
          .from(billingCheckouts)
          .where(and(eq(billingCheckouts.userId, req.authUser!.id), eq(billingCheckouts.purpose, 'studio')))
          .orderBy(desc(billingCheckouts.createdAt))
          .limit(1);
        checkoutId = latest?.checkoutId;
      }
      if (!checkoutId) return reply.code(404).send({ error: 'No checkout to confirm' });

      const [row] = await app.db
        .select()
        .from(billingCheckouts)
        .where(
          and(eq(billingCheckouts.checkoutId, checkoutId), eq(billingCheckouts.userId, req.authUser!.id)),
        )
        .limit(1);
      if (!row) return reply.code(404).send({ error: 'Checkout not found' });

      if (row.status === 'paid' || req.authUser!.isStudio) {
        return { ok: true, isStudio: true, already: true };
      }

      const session = await getBachsCheckout(app.env, checkoutId);
      if (!bachsCheckoutPaid(session)) {
        return {
          ok: false,
          isStudio: false,
          status: session.status ?? 'open',
          paymentStatus: session.payment_status,
        };
      }

      await app.db
        .update(billingCheckouts)
        .set({ status: 'paid', updatedAt: new Date() })
        .where(eq(billingCheckouts.id, row.id));
      const until = await grantStudio(app, req, req.authUser!.id, checkoutId);
      return { ok: true, isStudio: true, studioUntil: until.toISOString() };
    },
  );

  await app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
      done(null, body);
    });
    scope.post(
      '/billing/webhooks/bachs',
      { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
      async (req, reply) => {
        const raw = typeof req.body === 'string' ? req.body : '';
        const signature = String(req.headers['x-bachs-signature'] ?? '');
        const timestamp = String(req.headers['x-bachs-timestamp'] ?? '');
        if (!verifyBachsSignature(raw, app.env.BACHS_WEBHOOK_SECRET, timestamp, signature)) {
          return reply.code(401).send({ error: 'Invalid signature' });
        }
        const event = JSON.parse(raw) as {
          id?: string;
          type?: string;
          data?: {
            checkout_id?: string;
            metadata?: { user_id?: string; purpose?: string };
          };
        };
        if (!event.id || !event.type) return reply.code(400).send({ error: 'Bad event' });
        const [seen] = await app.db
          .select({ eventId: billingWebhookEvents.eventId })
          .from(billingWebhookEvents)
          .where(eq(billingWebhookEvents.eventId, event.id))
          .limit(1);
        if (seen) return { ok: true, duplicate: true };
        await app.db.insert(billingWebhookEvents).values({ eventId: event.id });

        if (event.type === 'collection.succeeded' || event.type === 'checkout.completed') {
          const checkoutId = event.data?.checkout_id;
          let userId = event.data?.metadata?.user_id;
          if (checkoutId) {
            const [row] = await app.db
              .select()
              .from(billingCheckouts)
              .where(eq(billingCheckouts.checkoutId, checkoutId))
              .limit(1);
            if (row) {
              userId = row.userId;
              await app.db
                .update(billingCheckouts)
                .set({ status: 'paid', updatedAt: new Date() })
                .where(and(eq(billingCheckouts.id, row.id), eq(billingCheckouts.status, 'open')));
            }
          }
          if (userId) {
            await grantStudio(app, req, userId, checkoutId);
          }
        }
        return { ok: true };
      },
    );
  });
}
