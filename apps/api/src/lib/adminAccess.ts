import type { FastifyRequest } from 'fastify';
import { isPrivateAdminRequest } from '@voiceout/shared';
import type { Env } from '../env.js';

export function adminRequiresLan(env: Env) {
  const flag = env.ADMIN_LAN_ONLY.trim().toLowerCase();
  if (flag === 'true' || flag === '1') return true;
  if (flag === 'false' || flag === '0') return false;
  return env.NODE_ENV !== 'production';
}

export function requestClientIp(req: FastifyRequest) {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '')
    .split(',')[0]
    ?.trim();
  if (forwarded) return forwarded;
  return req.ip ?? '';
}

export function requestHostname(req: FastifyRequest) {
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '')
    .split(',')[0]
    ?.trim()
    .split(':')[0];
  return host ?? '';
}

export function isLanAdminRequest(req: FastifyRequest) {
  return isPrivateAdminRequest(requestHostname(req), requestClientIp(req));
}
