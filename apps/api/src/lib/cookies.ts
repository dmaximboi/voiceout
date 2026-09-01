import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Env } from '../env.js';
import { timingSafeEqualStr } from './crypto.js';

const ACCESS = 'vo_access';
const REFRESH = 'vo_refresh';
const CSRF = 'vo_csrf';

function cookieBase(env: Env, secureOverride?: boolean) {
  const secure = secureOverride ?? (env.NODE_ENV === 'production' || env.WEB_ORIGIN.startsWith('https://'));
  return {
    path: '/',
    sameSite: (secure ? 'none' : 'lax') as 'none' | 'lax',
    secure,
    httpOnly: true as const,
  };
}

export function setCsrfCookie(reply: FastifyReply, env: Env, csrf: string, opts?: { secure?: boolean }) {
  const base = cookieBase(env, opts?.secure);
  reply.setCookie(CSRF, csrf, {
    ...base,
    httpOnly: false,
    maxAge: 60 * 60 * 24 * 7,
  });
}

export function setAuthCookies(
  reply: FastifyReply,
  env: Env,
  access: string,
  refresh: string,
  csrf: string,
  opts?: { secure?: boolean },
) {
  const base = cookieBase(env, opts?.secure);
  reply.setCookie(ACCESS, access, { ...base, maxAge: 60 * 15 });
  reply.setCookie(REFRESH, refresh, { ...base, maxAge: 60 * 60 * 24 * 7 });
  setCsrfCookie(reply, env, csrf, opts);
}

export function clearAuthCookies(reply: FastifyReply, env: Env) {
  const base = cookieBase(env);
  reply.clearCookie(ACCESS, base);
  reply.clearCookie(REFRESH, base);
  reply.clearCookie(CSRF, { ...base, httpOnly: false });
}

export function readCookies(req: FastifyRequest) {
  return {
    access: req.cookies[ACCESS],
    refresh: req.cookies[REFRESH],
    csrf: req.cookies[CSRF],
  };
}

export function assertCsrf(req: FastifyRequest) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
  const cookie = req.cookies[CSRF] ?? '';
  const header = typeof req.headers['x-csrf-token'] === 'string' ? req.headers['x-csrf-token'] : '';
  if (!cookie || !header || !timingSafeEqualStr(cookie, header)) {
    const err = new Error('CSRF');
    (err as Error & { statusCode?: number }).statusCode = 403;
    throw err;
  }
}
