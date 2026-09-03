import { SignJWT, jwtVerify } from 'jose';
import type { Env } from '../env.js';

export type AccessPayload = { sub: string; sid: string };

function keyOf(secret: string) {
  return new TextEncoder().encode(secret);
}

export async function signAccess(env: Env, payload: AccessPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(env.JWT_ISS)
    .setAudience(env.JWT_AUD)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(keyOf(env.JWT_SECRET));
}

async function verifyWith(secret: string, env: Env, token: string): Promise<AccessPayload | null> {
  try {
    const { payload } = await jwtVerify(token, keyOf(secret), {
      issuer: env.JWT_ISS,
      audience: env.JWT_AUD,
    });
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
    return { sub: payload.sub, sid: payload.sid };
  } catch {
    return null;
  }
}

export async function verifyAccess(env: Env, token: string): Promise<AccessPayload | null> {
  const primary = await verifyWith(env.JWT_SECRET, env, token);
  if (primary) return primary;
  if (env.JWT_SECRET_PREV.length >= 32) return verifyWith(env.JWT_SECRET_PREV, env, token);
  return null;
}
