import { users, type Db } from '@voiceout/db';
import { sql } from 'drizzle-orm';

/** Public profile fields only — never pull password/email ciphertext into feed hydration. */
export const userPublicColumns = {
  id: users.id,
  handle: users.handle,
  displayName: users.displayName,
  bio: users.bio,
  avatarMediaId: users.avatarMediaId,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
  lang: users.lang,
  region: users.region,
  city: users.city,
  country: users.country,
  deletedAt: users.deletedAt,
  suspendedAt: users.suspendedAt,
  role: users.role,
  planTier: users.planTier,
  studioUntil: users.studioUntil,
} as const;

/** Signed-in self / login row. Includes email and password hash; do not send hash to clients. */
export const userSelfColumns = {
  ...userPublicColumns,
  email: users.email,
  emailVerifiedAt: users.emailVerifiedAt,
  passwordHash: users.passwordHash,
  phone: users.phone,
  failedLoginCount: users.failedLoginCount,
  lockedUntil: users.lockedUntil,
  warningCount: users.warningCount,
  warnedAt: users.warnedAt,
  suspensionReason: users.suspensionReason,
  suspendedBy: users.suspendedBy,
  profileNameChangedAt: users.profileNameChangedAt,
  avatarChangedAt: users.avatarChangedAt,
  passwordChangedAt: users.passwordChangedAt,
  adminDeviceHash: users.adminDeviceHash,
  erasedAt: users.erasedAt,
  emailHmac: users.emailHmac,
  emailCt: users.emailCt,
  emailNonce: users.emailNonce,
} as const;

/** @deprecated use userPublicColumns */
export const userDirectoryColumns = userPublicColumns;

/**
 * Temporarily disable RLS for service work that must cross users (credential lookup,
 * counters, block checks). Restores whatever was set before, so nesting is safe.
 * The setting is per connection: never run this concurrently with other queries
 * of the same request (e.g. inside Promise.all).
 */
export async function withRlsOff<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  // Materialized CTE reads the old value before set_config runs in the outer projection.
  const [row] = await db.execute<{ prev: string | null }>(sql`
    with s as materialized (select current_setting('app.rls', true) as prev)
    select prev, set_config('app.rls', 'off', true) from s
  `);
  if (row?.prev === 'off') return fn();
  try {
    return await fn();
  } finally {
    await db.execute(sql`select set_config('app.rls', 'on', true)`).catch(() => undefined);
  }
}

export function isUniqueViolation(err: unknown): boolean {
  const code =
    err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';
  return code === '23505';
}
