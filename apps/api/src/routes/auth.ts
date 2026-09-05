import type { FastifyInstance } from 'fastify';
import { oauthAccounts, sessions, users, deviceLinks } from '@voiceout/db';
import { and, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { loginSchema, registerSchema, forgotPasswordSchema, resetPasswordSchema, verifyEmailSchema } from '@voiceout/shared';
import { hashPassword, randomToken, sha256, verifyPassword } from '../lib/crypto.js';
import { sendMail } from '../lib/mail.js';
import { consumeRedisToken, issueRedisToken, issueOtpCode, consumeOtpCode } from '../lib/tokens.js';
import { clearAuthCookies, readCookies, setAuthCookies, setCsrfCookie, setDeviceCookie } from '../lib/cookies.js';
import { createSession, issueHandoff, issueSession } from '../lib/session.js';
import { toMeUser } from '../lib/cooldown.js';
import { ensureBootstrapAdmin } from '../lib/adminEmails.js';
import { requireAuth, requireCsrf, grantAdminStepUp, adminStepUpRemaining } from '../plugins/auth.js';
import { assertFlag } from '../lib/flags.js';
import { sanitizeText } from '../lib/sanitize.js';
import { writeAudit } from '../lib/audit.js';
import { oauthApiOrigin, requestWebOrigin, webOrigin } from '../lib/origins.js';
import { asDbUser, ensureUserSealed, findLiveUserByEmail } from '../lib/erasure.js';
import { isUniqueViolation, withRlsOff } from '../lib/rls.js';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  configuredAuthProviders,
  telegramLoginFromUpdate,
  validateTelegramLogin,
  type TelegramBotProfile,
} from '../lib/telegram.js';

const LOCK_AFTER = 12;
const LOCK_MS = 5 * 60 * 1000;
const TG_LOGIN_TTL = 300;

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/register', { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (req, reply) => {
    requireCsrf(req);
    const body = registerSchema.parse(req.body);
    return withRlsOff(app.db, async () => {
      const existingEmail = await findLiveUserByEmail(app.db, app.env, body.email);
      if (existingEmail) return reply.code(409).send({ error: 'Email already registered' });
      const [existingHandle] = await app.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.handle, body.handle))
        .limit(1);
      if (existingHandle) return reply.code(409).send({ error: 'Handle taken' });
      const passwordHash = await hashPassword(body.password);
      let user: typeof users.$inferSelect;
      try {
        const [created] = await app.db
          .insert(users)
          .values({
            email: body.email,
            passwordHash,
            handle: body.handle,
            displayName: sanitizeText(body.displayName),
          })
          .returning();
        if (!created) return reply.code(500).send({ error: 'Failed' });
        user = created;
      } catch (err) {
        if (isUniqueViolation(err)) {
          return reply.code(409).send({ error: 'Email or handle already registered' });
        }
        throw err;
      }
      if (!user.id) return reply.code(500).send({ error: 'Failed' });
      await asDbUser(app.db, user.id);
      const sealed = await ensureUserSealed(app.db, app.env, user);
      await issueSession(app.db, app.env, reply, sealed.id, {
        userAgent: req.headers['user-agent'],
        ip: req.ip,
      });
      await writeAudit(app.db, req, 'register', sealed.id);
      const verifyToken = await issueRedisToken(app.redis, 'vo:verify', sealed.id, 60 * 60 * 24);
      const verifyUrl = `${app.env.WEB_ORIGIN}/login?verify=${verifyToken}`;
      await sendMail(app.env, req.log, {
        to: sealed.email,
        kind: 'verify_email',
        url: verifyUrl,
      });
      return { user: await toMeUser(app.db, app.env, app.s3, sealed) };
    });
  });

  app.post('/auth/login', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    requireCsrf(req);
    const body = loginSchema.parse(req.body);
    return withRlsOff(app.db, async () => {
      const login = body.login.trim().toLowerCase().replace(/^@/, '');
      const user = login.includes('@')
        ? await findLiveUserByEmail(app.db, app.env, login)
        : (
            await app.db
              .select()
              .from(users)
              .where(and(eq(users.handle, login), isNull(users.deletedAt)))
              .limit(1)
          )[0];
      if (!user || !user.passwordHash) return reply.code(401).send({ error: 'Invalid credentials' });
      const ok = await verifyPassword(user.passwordHash, body.password);
      // Correct password always wins — clear stale locks so “temporarily locked”
      // cannot block a valid login while an existing session still works on reload.
      if (ok) {
        await app.db
          .update(users)
          .set({ failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
          .where(eq(users.id, user.id));
      } else {
        const locked = user.lockedUntil && user.lockedUntil > new Date();
        if (locked) {
          return reply.code(423).send({ error: 'Account temporarily locked. Try again in a few minutes.' });
        }
        const fails = user.failedLoginCount + 1;
        await app.db
          .update(users)
          .set({
            failedLoginCount: fails,
            lockedUntil: fails >= LOCK_AFTER ? new Date(Date.now() + LOCK_MS) : null,
            updatedAt: new Date(),
          })
          .where(eq(users.id, user.id));
        return reply.code(401).send({ error: 'Invalid credentials' });
      }
      await asDbUser(app.db, user.id);
      const sealed = await ensureUserSealed(app.db, app.env, user);
      await issueSession(app.db, app.env, reply, sealed.id, {
        userAgent: req.headers['user-agent'],
        ip: req.ip,
      });
      await writeAudit(app.db, req, 'login', sealed.id);
      return { user: await toMeUser(app.db, app.env, app.s3, sealed) };
    });
  });

  app.post('/auth/logout', async (req, reply) => {
    requireCsrf(req);
    const { refresh } = readCookies(req);
    if (refresh) {
      await app.db.delete(sessions).where(eq(sessions.refreshTokenHash, sha256(refresh)));
    }
    clearAuthCookies(reply, app.env);
    return { ok: true };
  });

  app.post('/auth/refresh', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    requireCsrf(req);
    const { refresh } = readCookies(req);
    if (!refresh) return reply.code(401).send({ error: 'No session' });
    const hash = sha256(refresh);
    const [session] = await app.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.refreshTokenHash, hash), gt(sessions.expiresAt, new Date())))
      .limit(1);
    if (!session) {
      clearAuthCookies(reply, app.env);
      return reply.code(401).send({ error: 'Expired session' });
    }
    const [live] = await app.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, session.userId), isNull(users.deletedAt)))
      .limit(1);
    if (!live) {
      await app.db.delete(sessions).where(eq(sessions.id, session.id));
      clearAuthCookies(reply, app.env);
      return reply.code(401).send({ error: 'Expired session' });
    }
    await app.db.delete(sessions).where(eq(sessions.id, session.id));
    await issueSession(app.db, app.env, reply, session.userId, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    return { ok: true };
  });

  app.get('/auth/me', async (req, reply) => {
    if (!req.authUser) return reply.code(401).send({ error: 'Unauthorized' });
    const [row] = await app.db.select().from(users).where(eq(users.id, req.authUser.id)).limit(1);
    if (!row) return reply.code(401).send({ error: 'Unauthorized' });
    const user = await ensureBootstrapAdmin(app.db, app.env, row);
    return { user: await toMeUser(app.db, app.env, app.s3, user) };
  });

  app.get('/auth/csrf', async (req, reply) => {
    const { csrf } = readCookies(req);
    if (csrf) return { csrf };
    const token = randomToken(24);
    setCsrfCookie(reply, app.env, token);
    return { csrf: token };
  });

  app.post('/auth/forgot-password', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
    requireCsrf(req);
    const body = forgotPasswordSchema.parse(req.body);
    const user = await findLiveUserByEmail(app.db, app.env, body.email);
    if (user?.passwordHash) {
      const token = await issueRedisToken(app.redis, 'vo:reset', user.id, 60 * 60);
      const url = `${app.env.WEB_ORIGIN}/login?reset=${token}`;
      await sendMail(app.env, req.log, {
        to: user.email,
        kind: 'reset_password',
        url,
      });
    }
    return { ok: true };
  });

  app.post('/auth/reset-password', { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (req, reply) => {
    requireCsrf(req);
    const body = resetPasswordSchema.parse(req.body);
    const userId = await consumeRedisToken(app.redis, 'vo:reset', body.token);
    if (!userId) return reply.code(400).send({ error: 'Invalid or expired reset link' });
    const [live] = await app.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    if (!live) return reply.code(400).send({ error: 'Invalid or expired reset link' });
    const passwordHash = await hashPassword(body.password);
    await app.db.execute(sql`select set_config('app.allow_password', 'on', true)`);
    await app.db
      .update(users)
      .set({ passwordHash, failedLoginCount: 0, lockedUntil: null, passwordChangedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, userId));
    await app.db.delete(sessions).where(eq(sessions.userId, userId));
    return { ok: true };
  });

  app.post('/auth/verify-email', async (req, reply) => {
    requireCsrf(req);
    const body = verifyEmailSchema.parse(req.body);
    const userId = await consumeRedisToken(app.redis, 'vo:verify', body.token);
    if (!userId) return reply.code(400).send({ error: 'Invalid or expired verify link' });
    await app.db.update(users).set({ emailVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, userId));
    return { ok: true };
  });

  app.post('/auth/resend-verify', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    requireAuth(req, reply);
    requireCsrf(req);
    const [user] = await app.db.select().from(users).where(eq(users.id, req.authUser!.id)).limit(1);
    if (!user) return reply.code(404).send({ error: 'Not found' });
    if (user.emailVerifiedAt) return { ok: true };
    const token = await issueRedisToken(app.redis, 'vo:verify', user.id, 60 * 60 * 24);
    const url = `${app.env.WEB_ORIGIN}/login?verify=${token}`;
    await sendMail(app.env, req.log, {
      to: user.email,
      kind: 'verify_email',
      url,
    });
    return { ok: true };
  });

  app.get('/auth/providers', async () => configuredAuthProviders(app.env));

  app.get('/auth/google', async (req, reply) => {
    assertFlag(app.env, 'KILL_OAUTH');
    if (!app.env.GOOGLE_CLIENT_ID || !app.env.GOOGLE_CLIENT_SECRET) {
      return reply.code(404).send({ error: 'Provider unavailable' });
    }
    const state = randomToken(16);
    const next = safeNext((req.query as { next?: string }).next);
    reply.setCookie('vo_oauth_state', state, oauthCookie(app));
    reply.setCookie('vo_oauth_next', next, oauthCookie(app));
    const params = new URLSearchParams({
      client_id: app.env.GOOGLE_CLIENT_ID,
      redirect_uri: `${oauthApiOrigin(app.env)}/auth/google/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    });
    return reply.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  });

  app.get('/auth/google/callback', async (req, reply) => {
    if (!app.env.GOOGLE_CLIENT_ID || !app.env.GOOGLE_CLIENT_SECRET) {
      return reply.redirect(`${webOrigin(app.env)}/login?error=oauth`);
    }
    const q = req.query as { code?: string; state?: string };
    const stateCookie = req.cookies.vo_oauth_state;
    if (!q.code || !q.state || !stateCookie || q.state !== stateCookie) {
      return reply.redirect(`${webOrigin(app.env)}/login?error=oauth`);
    }
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: q.code,
        client_id: app.env.GOOGLE_CLIENT_ID,
        client_secret: app.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${oauthApiOrigin(app.env)}/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) return reply.redirect(`${webOrigin(app.env)}/login?error=oauth`);
    const oauthTokens = (await tokenRes.json()) as { access_token?: string };
    const profileRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${oauthTokens.access_token}` },
    });
    if (!profileRes.ok) return reply.redirect(`${webOrigin(app.env)}/login?error=oauth`);
    const profile = (await profileRes.json()) as { sub: string; email?: string; name?: string };
    if (!profile.email) return reply.redirect(`${webOrigin(app.env)}/login?error=oauth`);
    let user;
    try {
      user = await upsertOAuth(app, 'google', profile.sub, profile.email, profile.name ?? 'User');
    } catch (err) {
      return redirectOAuthLinkError(app, reply, err);
    }
    const sessionTokens = await issueSession(app.db, app.env, reply, user.id, { userAgent: req.headers['user-agent'], ip: req.ip });
    await writeAudit(app.db, req, 'login_google', user.id);
    const key = await issueHandoff(app.redis, sessionTokens);
    return finishOAuth(app, reply, req.cookies.vo_oauth_next, key);
  });

  app.get('/auth/github', async (req, reply) => {
    if (legacyProvidersDisabled()) return reply.code(404).send({ error: 'Provider unavailable' });
    /* legacy implementation retained for existing account data; new sign-ins are disabled */
    assertFlag(app.env, 'KILL_OAUTH');
    if (!app.env.GITHUB_CLIENT_ID) return reply.code(501).send({ error: 'GitHub OAuth not configured' });
    const state = randomToken(16);
    const next = safeNext((req.query as { next?: string }).next);
    reply.setCookie('vo_oauth_state', state, oauthCookie(app));
    reply.setCookie('vo_oauth_next', next, oauthCookie(app));
    const params = new URLSearchParams({
      client_id: app.env.GITHUB_CLIENT_ID,
      redirect_uri: `${oauthApiOrigin(app.env)}/auth/github/callback`,
      scope: 'read:user user:email',
      state,
    });
    return reply.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
  });

  app.get('/auth/github/callback', async (req, reply) => {
    if (legacyProvidersDisabled()) return reply.redirect(`${webOrigin(app.env)}/login?error=oauth`);
    /* legacy callback disabled */
    const q = req.query as { code?: string; state?: string };
    const stateCookie = req.cookies.vo_oauth_state;
    if (!q.code || !q.state || !stateCookie || q.state !== stateCookie) {
      return reply.redirect(`${webOrigin(app.env)}/login?error=oauth`);
    }
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: app.env.GITHUB_CLIENT_ID,
        client_secret: app.env.GITHUB_CLIENT_SECRET,
        code: q.code,
        redirect_uri: `${oauthApiOrigin(app.env)}/auth/github/callback`,
      }),
    });
    if (!tokenRes.ok) return reply.redirect(`${webOrigin(app.env)}/login?error=oauth`);
    const oauthTokens = (await tokenRes.json()) as { access_token?: string };
    if (!oauthTokens.access_token) return reply.redirect(`${webOrigin(app.env)}/login?error=oauth`);
    const profileRes = await fetch('https://api.github.com/user', {
      headers: { authorization: `Bearer ${oauthTokens.access_token}`, accept: 'application/json' },
    });
    if (!profileRes.ok) return reply.redirect(`${webOrigin(app.env)}/login?error=oauth`);
    const profile = (await profileRes.json()) as { id: number; login?: string; name?: string; email?: string | null };
    let email = profile.email ?? '';
    if (!email) {
      const mailRes = await fetch('https://api.github.com/user/emails', {
        headers: { authorization: `Bearer ${oauthTokens.access_token}`, accept: 'application/json' },
      });
      if (mailRes.ok) {
        const mails = (await mailRes.json()) as { email: string; primary?: boolean; verified?: boolean }[];
        email = mails.find((m) => m.primary && m.verified)?.email ?? mails.find((m) => m.verified)?.email ?? '';
      }
    }
    if (!email) return reply.redirect(`${webOrigin(app.env)}/login?error=oauth`);
    let user;
    try {
      user = await upsertOAuth(
        app,
        'github',
        String(profile.id),
        email,
        profile.name || profile.login || 'User',
      );
    } catch (err) {
      return redirectOAuthLinkError(app, reply, err);
    }
    const sessionTokens = await issueSession(app.db, app.env, reply, user.id, { userAgent: req.headers['user-agent'], ip: req.ip });
    await writeAudit(app.db, req, 'login_github', user.id);
    const key = await issueHandoff(app.redis, sessionTokens);
    return finishOAuth(app, reply, req.cookies.vo_oauth_next, key);
  });

  app.get('/auth/tiktok', async (req, reply) => {
    if (legacyProvidersDisabled()) return reply.code(404).send({ error: 'Provider unavailable' });
    /* legacy implementation retained for existing account data; new sign-ins are disabled */
    assertFlag(app.env, 'KILL_OAUTH');
    if (!app.env.TIKTOK_CLIENT_KEY) return reply.code(501).send({ error: 'TikTok OAuth not configured' });
    const state = randomToken(16);
    const next = safeNext((req.query as { next?: string }).next);
    reply.setCookie('vo_oauth_state', state, oauthCookie(app));
    reply.setCookie('vo_oauth_next', next, oauthCookie(app));
    const params = new URLSearchParams({
      client_key: app.env.TIKTOK_CLIENT_KEY,
      redirect_uri: `${oauthApiOrigin(app.env)}/auth/tiktok/callback`,
      response_type: 'code',
      scope: 'user.info.basic',
      state,
    });
    return reply.redirect(`https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`);
  });

  app.get('/auth/tiktok/callback', async (req, reply) => {
    if (legacyProvidersDisabled()) return reply.redirect(`${webOrigin(app.env)}/login?error=oauth`);
    /* legacy callback disabled */
    const q = req.query as { code?: string; state?: string };
    const stateCookie = req.cookies.vo_oauth_state;
    if (!q.code || !q.state || !stateCookie || q.state !== stateCookie) {
      return reply.redirect(`${webOrigin(app.env)}/login?error=oauth`);
    }
    const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: app.env.TIKTOK_CLIENT_KEY,
        client_secret: app.env.TIKTOK_CLIENT_SECRET,
        code: q.code,
        grant_type: 'authorization_code',
        redirect_uri: `${oauthApiOrigin(app.env)}/auth/tiktok/callback`,
      }),
    });
    if (!tokenRes.ok) return reply.redirect(`${webOrigin(app.env)}/login?error=oauth`);
    const oauthTokens = (await tokenRes.json()) as { access_token?: string; open_id?: string };
    if (!oauthTokens.access_token || !oauthTokens.open_id) {
      return reply.redirect(`${webOrigin(app.env)}/login?error=oauth`);
    }
    let displayName = 'User';
    const profileRes = await fetch(
      'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name',
      { headers: { authorization: `Bearer ${oauthTokens.access_token}` } },
    );
    if (profileRes.ok) {
      const body = (await profileRes.json()) as { data?: { user?: { display_name?: string } } };
      displayName = body.data?.user?.display_name || displayName;
    }
    const email = `tiktok_${oauthTokens.open_id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 40)}@users.invalid`;
    const user = await upsertOAuth(app, 'tiktok', oauthTokens.open_id, email, displayName);
    const sessionTokens = await issueSession(app.db, app.env, reply, user.id, { userAgent: req.headers['user-agent'], ip: req.ip });
    await writeAudit(app.db, req, 'login_tiktok', user.id);
    const key = await issueHandoff(app.redis, sessionTokens);
    return finishOAuth(app, reply, req.cookies.vo_oauth_next, key);
  });

  app.get('/auth/apple', async (req, reply) => {
    if (legacyProvidersDisabled()) return reply.code(404).send({ error: 'Provider unavailable' });
    /* legacy implementation retained for existing account data; new sign-ins are disabled */
    assertFlag(app.env, 'KILL_OAUTH');
    if (!app.env.APPLE_CLIENT_ID) return reply.code(501).send({ error: 'Apple OAuth not configured' });
    const state = randomToken(16);
    reply.setCookie('vo_oauth_state', state, oauthCookie(app));
    reply.setCookie('vo_oauth_next', safeNext((req.query as { next?: string }).next), oauthCookie(app));
    const params = new URLSearchParams({
      client_id: app.env.APPLE_CLIENT_ID,
      redirect_uri: `${oauthApiOrigin(app.env)}/auth/apple/callback`,
      response_type: 'code',
      response_mode: 'form_post',
      scope: 'name email',
      state,
    });
    return reply.redirect(`https://appleid.apple.com/auth/authorize?${params.toString()}`);
  });

  app.post('/auth/apple/callback', async (req, reply) => {
    if (legacyProvidersDisabled()) return reply.redirect(`${webOrigin(app.env)}/login?error=oauth`);
    /* legacy callback disabled */
    const body = req.body as { code?: string; state?: string; user?: string };
    const stateCookie = req.cookies.vo_oauth_state;
    if (!body.code || !body.state || body.state !== stateCookie) {
      return reply.redirect(`${webOrigin(app.env)}/login?error=oauth`);
    }
    // Token exchange requires a client secret JWT signed with Apple private key.
    // When credentials exist we still require a valid identity; v1 stores the Apple sub from the code path via token endpoint.
    try {
      const secret = await appleClientSecret(app);
      const tokenRes = await fetch('https://appleid.apple.com/auth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: app.env.APPLE_CLIENT_ID,
          client_secret: secret,
          code: body.code,
          grant_type: 'authorization_code',
          redirect_uri: `${oauthApiOrigin(app.env)}/auth/apple/callback`,
        }),
      });
      if (!tokenRes.ok) return reply.redirect(`${webOrigin(app.env)}/login?error=oauth`);
      const tokens = (await tokenRes.json()) as { id_token?: string };
      const payload = decodeJwt(tokens.id_token ?? '');
      const email = typeof payload.email === 'string' ? payload.email : `apple_${payload.sub}@privaterelay.appleid.com`;
      const name = body.user ? (JSON.parse(body.user) as { name?: { firstName?: string } }).name?.firstName : 'User';
      const user = await upsertOAuth(app, 'apple', String(payload.sub), email, name ?? 'User');
      const sessionTokens = await issueSession(app.db, app.env, reply, user.id, { userAgent: req.headers['user-agent'], ip: req.ip });
      await writeAudit(app.db, req, 'login_apple', user.id);
      const key = await issueHandoff(app.redis, sessionTokens);
      return finishOAuth(app, reply, req.cookies.vo_oauth_next, key);
    } catch (err) {
      if (err instanceof Error && err.message === 'EMAIL_UNVERIFIED') {
        return reply.redirect(`${webOrigin(app.env)}/login?error=email_unverified`);
      }
      req.log.error(err);
      return reply.redirect(`${webOrigin(app.env)}/login?error=oauth`);
    }
  });

  app.post(
    '/auth/telegram',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      requireCsrf(req);
      assertFlag(app.env, 'KILL_OAUTH');
      const providers = configuredAuthProviders(app.env);
      if (!providers.telegram) return reply.code(404).send({ error: 'Provider unavailable' });
      const body = req.body as { payload?: unknown; next?: string };
      const profile = validateTelegramLogin(body.payload, app.env.TELEGRAM_BOT_TOKEN);
      if (!profile) return reply.code(401).send({ error: 'Invalid Telegram login' });
      return finishTelegramLogin(app, req, reply, profile, body.next);
    },
  );

  app.post(
    '/auth/telegram/start',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      requireCsrf(req);
      assertFlag(app.env, 'KILL_OAUTH');
      const providers = configuredAuthProviders(app.env);
      if (!providers.telegram || !providers.telegramUsername) {
        return reply.code(404).send({ error: 'Provider unavailable' });
      }
      const next = safeNext((req.body as { next?: string } | undefined)?.next);
      const id = randomBytes(16).toString('hex');
      await app.redis.set(`vo:tg:login:${id}`, JSON.stringify({ status: 'pending', next }), 'EX', TG_LOGIN_TTL);
      return { id, url: `https://t.me/${providers.telegramUsername}?start=vo${id}` };
    },
  );

  app.get(
    '/auth/telegram/wait',
    { config: { rateLimit: { max: 40, timeWindow: '1 minute' } } },
    async (req, reply) => {
      assertFlag(app.env, 'KILL_OAUTH');
      const providers = configuredAuthProviders(app.env);
      if (!providers.telegram) return reply.code(404).send({ error: 'Provider unavailable' });
      const id = String((req.query as { id?: string }).id ?? '');
      if (!/^[a-f0-9]{32}$/.test(id)) return reply.code(400).send({ error: 'Invalid login' });
      await ingestTelegramStarts(app);
      const raw = await app.redis.get(`vo:tg:login:${id}`);
      if (!raw) return { status: 'expired' as const };
      const state = JSON.parse(raw) as { status: string; next?: string; profile?: TelegramBotProfile };
      if (state.status !== 'ready' || !state.profile) return { status: 'pending' as const };
      await app.redis.del(`vo:tg:login:${id}`);
      const result = await finishTelegramLogin(app, req, reply, state.profile, state.next);
      return { status: 'done' as const, handoff: result.handoff };
    },
  );

  app.post(
    '/auth/device-link',
    { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      requireAuth(req, reply);
      requireCsrf(req);
      const tokens = await createSession(app.db, app.env, req.authUser!.id, {
        userAgent: req.headers['user-agent'],
        ip: req.ip,
      });
      const k = await issueHandoff(app.redis, {
        access: tokens.access,
        refresh: tokens.refresh,
        csrf: tokens.csrf,
      });
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      const [row] = await app.db
        .insert(deviceLinks)
        .values({
          userId: req.authUser!.id,
          sessionId: tokens.sessionId,
          tokenHash: sha256(k),
          label: 'Phone link',
          expiresAt,
        })
        .returning();
      return {
        k,
        link: row
          ? {
              id: row.id,
              label: row.label,
              createdAt: row.createdAt.toISOString(),
              expiresAt: row.expiresAt.toISOString(),
              claimedAt: null as string | null,
              revokedAt: null as string | null,
            }
          : null,
      };
    },
  );

  app.get('/auth/device-links', async (req, reply) => {
    requireAuth(req, reply);
    const rows = await app.db
      .select()
      .from(deviceLinks)
      .where(eq(deviceLinks.userId, req.authUser!.id))
      .orderBy(desc(deviceLinks.createdAt))
      .limit(20);
    return {
      links: rows.map((r) => ({
        id: r.id,
        label: r.label,
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
        claimedAt: r.claimedAt?.toISOString() ?? null,
        revokedAt: r.revokedAt?.toISOString() ?? null,
        active: !r.revokedAt && r.expiresAt > new Date(),
      })),
    };
  });

  app.delete('/auth/device-links/:id', async (req, reply) => {
    requireAuth(req, reply);
    requireCsrf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [row] = await app.db
      .select()
      .from(deviceLinks)
      .where(and(eq(deviceLinks.id, id), eq(deviceLinks.userId, req.authUser!.id)))
      .limit(1);
    if (!row) return reply.code(404).send({ error: 'Not found' });
    await app.db
      .update(deviceLinks)
      .set({ revokedAt: new Date() })
      .where(eq(deviceLinks.id, row.id));
    await app.db.delete(sessions).where(eq(sessions.id, row.sessionId));
    return { ok: true };
  });

  app.post(
    '/auth/switch-device',
    { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      requireAuth(req, reply);
      requireCsrf(req);
      const role = req.authUser!.role;
      if (role !== 'admin' && role !== 'moderator') {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const token = randomToken(32);
      await app.db
        .update(users)
        .set({ adminDeviceHash: sha256(token), updatedAt: new Date() })
        .where(eq(users.id, req.authUser!.id));
      setDeviceCookie(reply, app.env, token);
      await writeAudit(app.db, req, 'switch_device_bound', req.authUser!.id);
      return { ok: true };
    },
  );

  app.get('/auth/admin-stepup/status', async (req, reply) => {
    requireAuth(req, reply);
    const role = req.authUser!.role;
    if (role !== 'admin' && role !== 'moderator') {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const remainingSec = await adminStepUpRemaining(app, req.authUser!.id);
    return { active: remainingSec > 0, remainingSec };
  });

  app.post(
    '/auth/admin-stepup/code',
    { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      requireAuth(req, reply);
      requireCsrf(req);
      const role = req.authUser!.role;
      if (role !== 'admin' && role !== 'moderator') {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const [user] = await app.db.select().from(users).where(eq(users.id, req.authUser!.id)).limit(1);
      if (!user || user.email.endsWith('@users.invalid')) {
        return reply.code(400).send({ error: 'Add a real email before using email confirmation' });
      }
      const code = await issueOtpCode(app.redis, 'vo:admin-stepup-otp', user.id, {});
      await sendMail(app.env, req.log, {
        to: user.email,
        kind: 'admin_stepup_code',
        code,
      });
      await writeAudit(app.db, req, 'admin_stepup_code', req.authUser!.id);
      return { ok: true };
    },
  );

  app.post(
    '/auth/admin-stepup',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      requireAuth(req, reply);
      requireCsrf(req);
      const role = req.authUser!.role;
      if (role !== 'admin' && role !== 'moderator') {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const body = z
        .object({
          password: z.string().min(1).max(128).optional(),
          code: z.string().trim().min(4).max(12).optional(),
        })
        .parse(req.body ?? {});
      if (!body.password && !body.code) {
        return reply.code(400).send({ error: 'Enter your password or email code' });
      }
      const [user] = await app.db.select().from(users).where(eq(users.id, req.authUser!.id)).limit(1);
      if (!user) return reply.code(401).send({ error: 'Unauthorized' });

      if (body.password) {
        if (!user.passwordHash) {
          return reply.code(400).send({ error: 'This account has no password. Use the email code.' });
        }
        const ok = await verifyPassword(user.passwordHash, body.password);
        if (!ok) return reply.code(401).send({ error: 'Wrong password' });
      } else if (body.code) {
        const otp = await consumeOtpCode(app.redis, 'vo:admin-stepup-otp', user.id, body.code);
        if (!otp) return reply.code(400).send({ error: 'Invalid or expired code' });
      }

      const ttl = await grantAdminStepUp(app, user.id);
      await writeAudit(app.db, req, 'admin_stepup', user.id);
      return { ok: true, remainingSec: ttl };
    },
  );

  app.get('/auth/handoff', async (req, reply) => {
    const origin = requestWebOrigin(req, app.env);
    const q = req.query as { k?: string; next?: string };
    // Do not consume here — chat apps prefetch GET links and would burn one-time keys.
    const params = new URLSearchParams();
    if (q.k) params.set('k', q.k);
    params.set('next', safeNext(q.next));
    return reply.redirect(`${origin}/device-login?${params.toString()}`);
  });

  app.post('/auth/handoff/claim', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    requireCsrf(req);
    const body = z.object({ k: z.string().min(8).max(128), next: z.string().optional() }).parse(req.body ?? {});
    const tokenHash = sha256(body.k);
    const [link] = await app.db.select().from(deviceLinks).where(eq(deviceLinks.tokenHash, tokenHash)).limit(1);
    if (link?.revokedAt) return reply.code(400).send({ error: 'Link revoked' });
    if (link && link.expiresAt < new Date()) return reply.code(400).send({ error: 'Link expired' });
    const raw = await app.redis.get(`vo:handoff:${body.k}`);
    if (!raw) return reply.code(400).send({ error: 'Link expired or already used' });
    await app.redis.del(`vo:handoff:${body.k}`);
    const tokens = JSON.parse(raw) as { access: string; refresh: string; csrf: string };
    const origin = requestWebOrigin(req, app.env);
    setAuthCookies(reply, app.env, tokens.access, tokens.refresh, tokens.csrf, {
      secure: origin.startsWith('https://'),
    });
    if (link) {
      await app.db
        .update(deviceLinks)
        .set({ claimedAt: new Date() })
        .where(and(eq(deviceLinks.id, link.id), isNull(deviceLinks.claimedAt)));
    }
    return { ok: true, next: safeNext(body.next) };
  });
}

function oauthCookie(app: FastifyInstance) {
  const https = app.env.WEB_ORIGIN.startsWith('https://');
  return {
    path: '/',
    httpOnly: true as const,
    sameSite: 'lax' as const,
    secure: app.env.NODE_ENV === 'production' || https,
    maxAge: 600,
  };
}

async function finishTelegramLogin(
  app: FastifyInstance,
  req: import('fastify').FastifyRequest,
  reply: import('fastify').FastifyReply,
  profile: TelegramBotProfile & { phone?: string },
  next?: string,
) {
  const email = `telegram_${profile.id}@users.invalid`;
  const name =
    [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.username || 'Telegram user';
  const user = await upsertOAuth(app, 'telegram', profile.id, email, name, false);
  if (profile.phone) {
    const [taken] = await app.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.phone, profile.phone), ne(users.id, user.id)))
      .limit(1);
    if (taken) {
      return reply.code(409).send({
        error: 'This phone is already on another account. Log in there instead.',
        code: 'PHONE_IN_USE',
      });
    }
    if (!user.phone) {
      await app.db.update(users).set({ phone: profile.phone, updatedAt: new Date() }).where(eq(users.id, user.id));
    }
  }
  const tokens = await issueSession(app.db, app.env, reply, user.id, {
    userAgent: req.headers['user-agent'],
    ip: req.ip,
  });
  await writeAudit(app.db, req, 'login_telegram', user.id);
  const key = await issueHandoff(app.redis, tokens);
  return { handoff: `/vo-api/auth/handoff?k=${encodeURIComponent(key)}&next=${encodeURIComponent(safeNext(next))}` };
}

let telegramPollBusyUntil = 0;
let telegramOffsetCache: string | null = null;

async function ingestTelegramStarts(app: FastifyInstance) {
  const token = app.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  // In-memory throttle (was Redis SET NX + DEL every wait poll — burned Upstash during Telegram login).
  const now = Date.now();
  if (now < telegramPollBusyUntil) return;
  telegramPollBusyUntil = now + 3_000;
  try {
    const offset = telegramOffsetCache ?? (await app.redis.get('vo:tg:offset'));
    const url = new URL(`https://api.telegram.org/bot${token}/getUpdates`);
    url.searchParams.set('timeout', '0');
    url.searchParams.set('allowed_updates', JSON.stringify(['message']));
    if (offset) url.searchParams.set('offset', offset);
    let res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    let body = (await res.json()) as { ok?: boolean; result?: unknown[]; error_code?: number };
    if (body.error_code === 409) {
      await fetch(`https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=false`, {
        signal: AbortSignal.timeout(8000),
      });
      res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      body = (await res.json()) as { ok?: boolean; result?: unknown[]; error_code?: number };
    }
    if (!body.ok || !Array.isArray(body.result)) return;
    let maxId = offset ? Number(offset) - 1 : 0;
    for (const update of body.result) {
      const updateId = (update as { update_id?: number }).update_id;
      if (typeof updateId === 'number' && updateId > maxId) maxId = updateId;
      const parsed = telegramLoginFromUpdate(update);
      if (!parsed) continue;
      const key = `vo:tg:login:${parsed.loginId}`;
      const raw = await app.redis.get(key);
      if (!raw) continue;
      const state = JSON.parse(raw) as { status: string; next?: string };
      if (state.status !== 'pending') continue;
      await app.redis.set(
        key,
        JSON.stringify({ status: 'ready', next: state.next, profile: parsed.profile }),
        'EX',
        TG_LOGIN_TTL,
      );
    }
    if (body.result.length) {
      telegramOffsetCache = String(maxId + 1);
      await app.redis.set('vo:tg:offset', telegramOffsetCache);
    }
  } catch (err) {
    app.log.warn({ err }, 'telegram getUpdates failed');
  }
}

function safeNext(raw?: string) {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || raw.includes('://')) return '/';
  return raw.slice(0, 200);
}

function finishOAuth(app: FastifyInstance, reply: import('fastify').FastifyReply, nextCookie?: string, handoffKey?: string) {
  reply.clearCookie('vo_oauth_state', { path: '/' });
  reply.clearCookie('vo_oauth_next', { path: '/' });
  const next = safeNext(nextCookie);
  if (handoffKey) {
    const params = new URLSearchParams({ k: handoffKey, next });
    return reply.redirect(`${webOrigin(app.env)}/vo-api/auth/handoff?${params.toString()}`);
  }
  return reply.redirect(`${webOrigin(app.env)}${next}`);
}

function redirectOAuthLinkError(app: FastifyInstance, reply: import('fastify').FastifyReply, err: unknown) {
  if (err instanceof Error && err.message === 'EMAIL_UNVERIFIED') {
    return reply.redirect(`${webOrigin(app.env)}/login?error=email_unverified`);
  }
  throw err;
}

async function upsertOAuth(
  app: FastifyInstance,
  provider: 'google' | 'apple' | 'github' | 'tiktok' | 'telegram',
  providerAccountId: string,
  email: string,
  displayName: string,
  allowEmailLink = true,
) {
  const [existing] = await app.db
    .select()
    .from(oauthAccounts)
    .where(and(eq(oauthAccounts.provider, provider), eq(oauthAccounts.providerAccountId, providerAccountId)))
    .limit(1);
  if (existing) {
    const [user] = await app.db.select().from(users).where(eq(users.id, existing.userId)).limit(1);
    if (user && !user.deletedAt) {
      await asDbUser(app.db, user.id);
      return ensureUserSealed(app.db, app.env, user);
    }
    await app.db.delete(oauthAccounts).where(eq(oauthAccounts.id, existing.id));
  }
  const byEmail = allowEmailLink ? await findLiveUserByEmail(app.db, app.env, email) : null;
  if (byEmail) {
    // Block takeover: attacker registers unverified email, victim later OAuths that email.
    if (!byEmail.emailVerifiedAt) {
      throw new Error('EMAIL_UNVERIFIED');
    }
    await app.db.insert(oauthAccounts).values({ userId: byEmail.id, provider, providerAccountId });
    await asDbUser(app.db, byEmail.id);
    return ensureUserSealed(app.db, app.env, byEmail);
  }
  const handle = await uniqueHandle(app, email);
  const [user] = await app.db
    .insert(users)
    .values({
      email: email.toLowerCase(),
      emailVerifiedAt: new Date(),
      handle,
      displayName: sanitizeText(displayName).slice(0, 50) || 'User',
    })
    .returning();
  if (!user) throw new Error('oauth insert');
  await app.db.insert(oauthAccounts).values({ userId: user.id, provider, providerAccountId });
  await asDbUser(app.db, user.id);
  return ensureUserSealed(app.db, app.env, user);
}

async function uniqueHandle(app: FastifyInstance, email: string) {
  const base = email
    .split('@')[0]
    ?.toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 12) || 'user';
  for (let i = 0; i < 20; i++) {
    const handle = `${base}${i === 0 ? '' : i + Math.floor(Math.random() * 90)}`.slice(0, 20);
    const [hit] = await app.db.select({ id: users.id }).from(users).where(eq(users.handle, handle)).limit(1);
    if (!hit) return handle;
  }
  return `u${randomToken(6).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12)}`;
}

function decodeJwt(token: string): Record<string, unknown> {
  const part = token.split('.')[1];
  if (!part) return {};
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
}

async function appleClientSecret(app: FastifyInstance) {
  const { SignJWT, importPKCS8 } = await import('jose');
  const key = await importPKCS8(app.env.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n'), 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: app.env.APPLE_KEY_ID })
    .setIssuer(app.env.APPLE_TEAM_ID)
    .setAudience('https://appleid.apple.com')
    .setSubject(app.env.APPLE_CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key);
}

void requireAuth;

function legacyProvidersDisabled() {
  return true;
}
