import type { FastifyRequest } from 'fastify';
import type { Env } from '../env.js';

export function webOrigin(env: Env) {
  return env.WEB_ORIGIN.replace(/\/$/, '');
}

function hostnameOf(url: string) {
  return new URL(url).hostname.toLowerCase();
}

function isDevTunnelHost(host: string, env: Env) {
  if (env.NODE_ENV === 'production') return false;
  const h = host.toLowerCase().split(':')[0] ?? '';
  return (
    h.endsWith('.trycloudflare.com') ||
    h.endsWith('.loca.lt') ||
    h.endsWith('.ngrok-free.app') ||
    h.endsWith('.ngrok.io')
  );
}

function hostAllowed(host: string, env: Env) {
  const h = host.toLowerCase().split(':')[0] ?? '';
  if (h === hostnameOf(env.WEB_ORIGIN)) return true;
  const pub = env.PUBLIC_ORIGIN.trim();
  if (pub.startsWith('http') && h === hostnameOf(pub)) return true;
  if (isDevTunnelHost(h, env)) return true;
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

/** Prefer the browser Origin (HTTPS tunnel) for payment return URLs. */
export function checkoutReturnOrigin(req: FastifyRequest, env: Env) {
  for (const raw of [String(req.headers.origin ?? ''), String(req.headers.referer ?? '')]) {
    const value = raw.trim();
    if (!value.startsWith('http')) continue;
    try {
      const url = new URL(value);
      if (hostAllowed(url.hostname, env)) return url.origin;
    } catch {
      /* ignore bad header */
    }
  }
  return requestWebOrigin(req, env);
}

/** OAuth start + provider callback are browser routes on WEB_ORIGIN (`/auth/*` → API). */
export function oauthApiOrigin(env: Env) {
  return webOrigin(env);
}
