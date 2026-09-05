import type { FastifyInstance, FastifyRequest } from 'fastify';
import { billingCheckouts, billingWebhookEvents, users } from '@voiceout/db';
import { and, desc, eq, or } from 'drizzle-orm';
import {
  PLAN_DAYS,
  comparePlanTier,
  activePlanTier,
  planCheckoutSchema,
  planList,
  planPurpose,
  type PlanTier,
  tierFromPurpose,
} from '@voiceout/shared';
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

async function grantPlan(
  app: FastifyInstance,
  req: FastifyRequest,
  userId: string,
  tier: PlanTier,
  checkoutId?: string | null,
) {
  const [current] = await app.db
    .select({ studioUntil: users.studioUntil, planTier: users.planTier })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const active = activePlanTier(current?.planTier, current?.studioUntil);
  const base =
    current?.studioUntil && current.studioUntil.getTime() > Date.now()
      ? current.studioUntil.getTime()
      : Date.now();
  const until = new Date(base + PLAN_DAYS * 24 * 60 * 60 * 1000);
  const nextTier =
    active && comparePlanTier(active, tier) > 0 ? active : tier;
  await app.db
    .update(users)
    .set({ studioUntil: until, planTier: nextTier, updatedAt: new Date() })
    .where(eq(users.id, userId));
  await writeAudit(app.db, req, 'plan_paid', userId, {
    checkoutId: checkoutId ?? null,
    tier: nextTier,
    until: until.toISOString(),
  });
  return { until, tier: nextTier };
}

function openPlanPurpose(tier: PlanTier) {
  return planPurpose(tier);
}

export async function billingRoutes(app: FastifyInstance) {
  app.get('/billing/plans', async (req, reply) => {
    requireAuth(req, reply);
    const tier = req.authUser!.planTier;
    return {
      plans: planList(),
      currentTier: tier,
      checkoutReady: bachsConfigured(app.env),
      webhookPath: '/billing/webhooks/bachs',
      webhookUrlHint: 'https://api.voiceout.xyz/billing/webhooks/bachs',
    };
  });

  /** @deprecated use GET /billing/plans */
  app.get('/billing/studio', async (req, reply) => {
    requireAuth(req, reply);
    return {
      plans: planList(),
      currentTier: req.authUser!.planTier,
      checkoutReady: bachsConfigured(app.env),
    };
  });

  app.post(
    '/billing/plans/checkout',
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
      const { tier } = planCheckoutSchema.parse(req.body ?? {});
      const current = req.authUser!.planTier;
      if (current && comparePlanTier(current, tier) >= 0) {
        return reply.code(409).send({ error: 'You already have this plan or higher' });
      }
      const [account] = await app.db
        .select({ email: users.email, displayName: users.displayName })
        .from(users)
        .where(eq(users.id, req.authUser!.id))
        .limit(1);
      if (!account) return reply.code(404).send({ error: 'Not found' });
      const reference = `plan_${tier}_${req.authUser!.id.slice(0, 8)}_${randomToken(8)}`;
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
          tier,
          successUrl: `${origin}/settings?plan=ok&tier=${tier}`,
          cancelUrl: `${origin}/settings?plan=cancel`,
          reference,
        });
      } catch (err) {
        req.log.error({ err }, 'bachs checkout failed');
        return reply.code(502).send({
          error: 'Could not start checkout',
        });
      }
      await app.db.insert(billingCheckouts).values({
        userId: req.authUser!.id,
        checkoutId: session.checkoutId,
        status: 'open',
        purpose: openPlanPurpose(tier),
      });
      await writeAudit(app.db, req, 'plan_checkout_started', req.authUser!.id, {
        checkoutId: session.checkoutId,
        tier,
      });
      return { checkoutUrl: session.checkoutUrl, checkoutId: session.checkoutId, tier };
    },
  );

  /** @deprecated use POST /billing/plans/checkout */
  app.post(
    '/billing/studio/checkout',
    { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } },
    async (req, reply) => {
      req.body = { tier: 'basic' };
      return app.inject({
        method: 'POST',
        url: '/billing/plans/checkout',
        headers: { ...req.headers, 'content-type': 'application/json' },
        payload: JSON.stringify({ tier: 'basic' }),
      }).then((res) => reply.code(res.statusCode).send(JSON.parse(res.body)));
    },
  );

  app.post(
    '/billing/plans/confirm',
    { config: { rateLimit: { max: 40, timeWindow: '1 minute' } } },
    async (req, reply) => {
      requireAuth(req, reply);
      requireCsrf(req);
      if (!bachsConfigured(app.env)) {
        return reply.code(503).send({ error: 'Payments are not configured yet' });
      }
      const body = z
        .object({
          checkoutId: z.string().trim().min(3).max(128).optional(),
          tier: z.enum(['basic', 'verified', 'gold']).optional(),
        })
        .parse(req.body ?? {});
      let checkoutId = body.checkoutId;
      if (!checkoutId) {
        const purposes = body.tier
          ? [openPlanPurpose(body.tier)]
          : ['plan_basic', 'plan_verified', 'plan_gold', 'studio'];
        const [latest] = await app.db
          .select({ checkoutId: billingCheckouts.checkoutId })
          .from(billingCheckouts)
          .where(
            and(
              eq(billingCheckouts.userId, req.authUser!.id),
              or(...purposes.map((p) => eq(billingCheckouts.purpose, p))),
            ),
          )
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

      const expectedTier = tierFromPurpose(row.purpose);
      if (!expectedTier) return reply.code(400).send({ error: 'Unknown checkout type' });

      if (row.status === 'paid') {
        return { ok: true, planTier: req.authUser!.planTier, already: true };
      }

      const session = await getBachsCheckout(app.env, checkoutId);
      if (!bachsCheckoutPaid(session)) {
        return {
          ok: false,
          planTier: null,
          status: session.status ?? 'open',
          paymentStatus: session.payment_status,
        };
      }

      await app.db
        .update(billingCheckouts)
        .set({ status: 'paid', updatedAt: new Date() })
        .where(eq(billingCheckouts.id, row.id));
      const granted = await grantPlan(app, req, req.authUser!.id, expectedTier, checkoutId);
      return {
        ok: true,
        planTier: granted.tier,
        planUntil: granted.until.toISOString(),
        isStudio: true,
      };
    },
  );

  /** @deprecated use POST /billing/plans/confirm */
  app.post(
    '/billing/studio/confirm',
    { config: { rateLimit: { max: 40, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      req.body = { ...body, tier: 'basic' };
      const res = await app.inject({
        method: 'POST',
        url: '/billing/plans/confirm',
        headers: { ...req.headers, 'content-type': 'application/json' },
        payload: JSON.stringify(req.body),
      });
      const parsed = JSON.parse(res.body) as Record<string, unknown>;
      if (parsed.ok) {
        parsed.isStudio = true;
        parsed.studioUntil = parsed.planUntil;
      }
      return reply.code(res.statusCode).send(parsed);
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
            metadata?: { user_id?: string; purpose?: string; plan_tier?: string };
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
          let tier: PlanTier | null = null;
          if (checkoutId) {
            const [row] = await app.db
              .select()
              .from(billingCheckouts)
              .where(eq(billingCheckouts.checkoutId, checkoutId))
              .limit(1);
            if (row) {
              userId = row.userId;
              tier = tierFromPurpose(row.purpose);
              await app.db
                .update(billingCheckouts)
                .set({ status: 'paid', updatedAt: new Date() })
                .where(and(eq(billingCheckouts.id, row.id), eq(billingCheckouts.status, 'open')));
            }
          }
          if (!tier && event.data?.metadata?.plan_tier) {
            const rawTier = event.data.metadata.plan_tier;
            if (rawTier === 'basic' || rawTier === 'verified' || rawTier === 'gold') tier = rawTier;
          }
          if (userId && tier) {
            await grantPlan(app, req, userId, tier, checkoutId);
          }
        }
        return { ok: true };
      },
    );
  });
}
