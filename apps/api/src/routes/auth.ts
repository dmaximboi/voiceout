import type { FastifyInstance } from 'fastify';
import { oauthAccounts, sessions, users } from '@voiceout/db';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { loginSchema, registerSchema, forgotPasswordSchema, resetPasswordSchema, verifyEmailSchema } from '@voiceout/shared';
import { hashPassword, randomToken, sha256, verifyPassword } from '../lib/crypto.js';
import { sendMail } from '../lib/mail.js';
import { consumeRedisToken, issueRedisToken } from '../lib/tokens.js';
import { clearAuthCookies, readCookies, setAuthCookies, setCsrfCookie } from '../lib/cookies.js';
import { createSession, issueHandoff, issueSession } from '../lib/session.js';
import { toMeUser } from '../lib/cooldown.js';
import { requireAuth, requireCsrf } from '../plugins/auth.js';
import { assertFlag } from '../lib/flags.js';
import { sanitizeText } from '../lib/sanitize.js';
import { writeAudit } from '../lib/audit.js';
import { oauthApiOrigin, requestWebOrigin, webOrigin } from '../lib/origins.js';
import { asDbUser, ensureUserSealed, findLiveUserByEmail } from '../lib/erasure.js';

const LOCK_AFTER = 8;
const LOCK_MS = 15 * 60 * 1000;

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/register', { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (req, reply) => {
    requireCsrf(req);
    const body = registerSchema.parse(req.body);
    const existingEmail = await findLiveUserByEmail(app.db, app.env, body.email);
    if (existingEmail) return reply.code(409).send({ error: 'Email already registered' });
    const [existingHandle] = await app.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.handle, body.handle))
      .limit(1);
    if (existingHandle) return reply.code(409).send({ error: 'Handle taken' });
    const passwordHash = await hashPassword(body.password);
    const [user] = await app.db
      .insert(users)
      .values({
        email: body.email,
        passwordHash,
        handle: body.handle,
        displayName: sanitizeText(body.displayName),
      })
      .returning();
    if (!user) return reply.code(500).send({ error: 'Failed' });
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
      subject: 'Verify your VoiceOut email',
      text: `Confirm your email: ${verifyUrl}`,
      url: verifyUrl,
    });
    return { user: await toMeUser(app.db, app.env, app.s3, sealed) };
  });

  app.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    requireCsrf(req);
    const body = loginSchema.parse(req.body);
    const user = await findLiveUserByEmail(app.db, app.env, body.email);
    if (!user || !user.passwordHash) return reply.code(401).send({ error: 'Invalid credentials' });
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return reply.code(423).send({ error: 'Account temporarily locked' });
    }
    const ok = await verifyPassword(user.passwordHash, body.password);
    if (!ok) {
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
    await app.db
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
      .where(eq(users.id, user.id));
    await asDbUser(app.db, user.id);
    const sealed = await ensureUserSealed(app.db, app.env, user);
    await issueSession(app.db, app.env, reply, sealed.id, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    await writeAudit(app.db, req, 'login', sealed.id);
    return { user: await toMeUser(app.db, app.env, app.s3, sealed) };
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
    const [user] = await app.db.select().from(users).where(eq(users.id, req.authUser.id)).limit(1);
    if (!user) return reply.code(401).send({ error: 'Unauthorized' });
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
        subject: 'Reset your VoiceOut password',
        text: `Reset your password (expires in 1 hour): ${url}`,
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
      subject: 'Verify your VoiceOut email',
      text: `Confirm your email: ${url}`,
      url,
    });
    return { ok: true };
  });

  app.get('/auth/providers', async () => ({
    google: Boolean(app.env.GOOGLE_CLIENT_ID && app.env.GOOGLE_CLIENT_SECRET),
    github: Boolean(app.env.GITHUB_CLIENT_ID && app.env.GITHUB_CLIENT_SECRET),
    tiktok: Boolean(app.env.TIKTOK_CLIENT_KEY && app.env.TIKTOK_CLIENT_SECRET),
  }));

  app.get('/auth/google', async (req, reply) => {
    assertFlag(app.env, 'KILL_OAUTH');
    if (!app.env.GOOGLE_CLIENT_ID) return reply.code(501).send({ error: 'Google OAuth not configured' });
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
    const user = await upsertOAuth(app, 'google', profile.sub, profile.email, profile.name ?? 'User');
    const sessionTokens = await issueSession(app.db, app.env, reply, user.id, { userAgent: req.headers['user-agent'], ip: req.ip });
    await writeAudit(app.db, req, 'login_google', user.id);
    const key = await issueHandoff(app.redis, sessionTokens);
    return finishOAuth(app, reply, req.cookies.vo_oauth_next, key);
  });

  app.get('/auth/github', async (req, reply) => {
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
    const user = await upsertOAuth(
      app,
      'github',
      String(profile.id),
      email,
      profile.name || profile.login || 'User',
    );
    const sessionTokens = await issueSession(app.db, app.env, reply, user.id, { userAgent: req.headers['user-agent'], ip: req.ip });
    await writeAudit(app.db, req, 'login_github', user.id);
    const key = await issueHandoff(app.redis, sessionTokens);
    return finishOAuth(app, reply, req.cookies.vo_oauth_next, key);
  });

  app.get('/auth/tiktok', async (req, reply) => {
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
      req.log.error(err);
      return reply.redirect(`${webOrigin(app.env)}/login?error=oauth`);
    }
  });

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
      const k = await issueHandoff(app.redis, tokens);
      return { k };
    },
  );

  app.get('/auth/handoff', async (req, reply) => {
    const origin = requestWebOrigin(req, app.env);
    const q = req.query as { k?: string; next?: string };
    if (!q.k) return reply.redirect(`${origin}/login?error=oauth`);
    const raw = await app.redis.get(`vo:handoff:${q.k}`);
    if (!raw) return reply.redirect(`${origin}/login?error=oauth`);
    await app.redis.del(`vo:handoff:${q.k}`);
    const tokens = JSON.parse(raw) as { access: string; refresh: string; csrf: string };
    setAuthCookies(reply, app.env, tokens.access, tokens.refresh, tokens.csrf, {
      secure: origin.startsWith('https://'),
    });
    return reply.redirect(`${origin}${safeNext(q.next)}`);
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

async function upsertOAuth(
  app: FastifyInstance,
  provider: 'google' | 'apple' | 'github' | 'tiktok',
  providerAccountId: string,
  email: string,
  displayName: string,
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
  const byEmail = await findLiveUserByEmail(app.db, app.env, email);
  if (byEmail) {
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
