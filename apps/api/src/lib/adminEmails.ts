import { eq } from 'drizzle-orm';
import { users, type Db } from '@voiceout/db';
import type { Env } from '../env.js';
import { withRlsOff } from './rls.js';

type BootstrapUser = {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
  role: (typeof users.$inferSelect)['role'];
};

export function parseAdminEmails(env: Env): Set<string> {
  return new Set(
    (env.ADMIN_EMAILS || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Promote bootstrap admins listed in ADMIN_EMAILS (comma-separated). Only once the inbox is
 * proven: anyone can register an unclaimed listed address.
 */
export async function ensureBootstrapAdmin<T extends BootstrapUser>(
  db: Db,
  env: Env,
  user: T,
): Promise<T> {
  const emails = parseAdminEmails(env);
  if (!emails.has(user.email.toLowerCase())) return user;
  if (user.role === 'admin' || !user.emailVerifiedAt) return user;
  await withRlsOff(db, () =>
    db.update(users).set({ role: 'admin', updatedAt: new Date() }).where(eq(users.id, user.id)),
  );
  return { ...user, role: 'admin' };
}
