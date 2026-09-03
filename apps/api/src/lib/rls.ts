import { users, type Db } from '@voiceout/db';
import { sql } from 'drizzle-orm';

/** Public profile fields only — never pull password/email ciphertext into feed hydration. */
export const userDirectoryColumns = {
  id: users.id,
  handle: users.handle,
  displayName: users.displayName,
  bio: users.bio,
  avatarMediaId: users.avatarMediaId,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
  lang: users.lang,
  region: users.region,
  deletedAt: users.deletedAt,
  suspendedAt: users.suspendedAt,
  role: users.role,
  planTier: users.planTier,
  studioUntil: users.studioUntil,
} as const;

/** Temporarily disable RLS for credential lookup / lockout (login, register, OAuth link). */
export async function withRlsOff<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  await db.execute(sql`select set_config('app.rls', 'off', true)`);
  try {
    return await fn();
  } finally {
    await db.execute(sql`select set_config('app.rls', 'on', true)`);
  }
}

export function isUniqueViolation(err: unknown): boolean {
  const code =
    err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';
  return code === '23505';
}
