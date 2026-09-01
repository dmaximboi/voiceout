import type { FastifyRequest } from 'fastify';
import type { Env } from '../env.js';

export function webOrigin(env: Env) {
  return env.WEB_ORIGIN.replace(/\/$/, '');
}

function hostnameOf(url: string) {
  return new URL(url).hostname.toLowerCase();
}

function hostAllowed(host: string, env: Env) {
  const h = host.toLowerCase().split(':')[0] ?? '';
  if (h === hostnameOf(env.WEB_ORIGIN)) return true;
  const pub = env.PUBLIC_ORIGIN.trim();
  if (pub.startsWith('http') && h === hostnameOf(pub)) return true;
  return false;
}

export function requestWebOrigin(req: FastifyRequest, env: Env) {
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '')
    .split(',')[0]
    ?.trim();
  const protoRaw = String(req.headers['x-forwarded-proto'] ?? '')
    .split(',')[0]
    ?.trim()
    .toLowerCase();
  const proto = protoRaw === 'https' || protoRaw === 'http' ? protoRaw : 'http';
  if (host && hostAllowed(host, env)) return `${proto}://${host}`.replace(/\/$/, '');
  return webOrigin(env);
}

/** OAuth start + provider callback are browser routes on WEB_ORIGIN (`/auth/*` → API). */
export function oauthApiOrigin(env: Env) {
  return webOrigin(env);
}
